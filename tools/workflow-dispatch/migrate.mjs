import { readFileSync } from "node:fs";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateProjectV2 } from "./check.mjs";
import { valid } from "./schema.mjs";
import {
  safe,
  snapshotConsistent,
  hash,
  same,
  fresh,
  active,
  pathValid,
  overlap,
  fail,
  code,
} from "./core.mjs";
const v1 = new Ajv({ strict: true });
addFormats(v1);
const root = new URL("../../.ai-workflow/schemas/", import.meta.url);
for (const [ns, kinds] of [
  ["issue", ["common"]],
  ["project", ["common", "project", "team", "delivery-plan"]],
])
  for (const k of kinds)
    v1.addSchema(
      JSON.parse(
        readFileSync(new URL(ns + "/v1/" + k + ".schema.json", root), "utf8"),
      ),
    );
export function previewMigration(input) {
  const r = {
    status: "blocked",
    authority: false,
    configuration_digest: null,
    manifest_digest: null,
    imported_claims: [],
    diagnostics: [],
  };
  try {
    if (
      !safe(input) ||
      Object.keys(input).sort().join() !==
        "evaluated_at,from,legacy_claims,migration,snapshot,to"
    )
      fail("migration_input_invalid");
    const {
      from,
      to,
      snapshot: s,
      legacy_claims: claims,
      migration: m,
      evaluated_at: now,
    } = input;
    const cfg = validateProjectV2(to);
    if (cfg.status !== "passed") fail(cfg.diagnostics[0]);
    if (from !== null) {
      if (
        !from ||
        Object.keys(from).sort().join() !== "deliveryPlan,project,team"
      )
        fail("migration_source_invalid");
      for (const [k, n] of [
        ["project", "project"],
        ["team", "team"],
        ["deliveryPlan", "delivery-plan"],
      ])
        if (!v1.getSchema("urn:ai-workflow:project:v1:" + n)(from[k]))
          fail("migration_source_invalid");
      if (
        from.project.project_id !== to.project.project_id ||
        from.project.repository !== to.project.repository ||
        from.team.project_id !== from.project.project_id ||
        from.deliveryPlan.project_id !== from.project.project_id
      )
        fail("migration_source_invalid");
    }
    if (
      !valid("urn:ai-workflow:dispatch:v1:migration", m) ||
      !valid("urn:ai-workflow:github:v1:snapshot", s) ||
      !Array.isArray(claims) ||
      claims.length > 10000 ||
      claims.some(
        (c) =>
          !valid("urn:ai-workflow:dispatch:v1:common#/$defs/claim", c) ||
          c.origin !== "manual-v1",
      )
    )
      fail("migration_input_invalid");
    if (
      m.project_id !== to.project.project_id ||
      m.configuration_digest !== cfg.configuration_digest ||
      m.source_digest !== (from === null ? null : hash(from)) ||
      m.inventory_digest !== hash({ snapshot: s, legacy_claims: claims }) ||
      s.repository !== to.project.repository ||
      s.repository_id !== to.project.repository_id
    )
      fail("migration_binding_mismatch");
    if (
      !snapshotConsistent(s) ||
      s.status !== "complete" ||
      s.unresolved.length ||
      Object.values(s.sections).some((x) => x !== "complete") ||
      !fresh(s.started_at, now) ||
      !fresh(s.finished_at, now) ||
      !fresh(m.observed_at, now)
    )
      fail("migration_inventory_unknown");
    for (const c of claims) {
      if (
        !to.team.members.some((m) => m.github_login === c.human_owner) ||
        !c.areas.length ||
        new Set(c.areas).size !== c.areas.length ||
        c.areas.some((id) => !to.project.areas.some((a) => a.area_id === id)) ||
        !c.allowed_paths.length ||
        [...c.allowed_paths, ...c.forbidden_paths].some((p) => !pathValid(p)) ||
        (c.status === "released" && c.execution_active) ||
        to.project.areas.some(
          (a) =>
            (a.shared || a.conflict_policy === "serialize") &&
            overlap(c.allowed_paths, a.paths) &&
            !c.areas.includes(a.area_id),
        )
      )
        fail("migration_claim_scope_invalid");
    }
    const dispositions = new Map();
    for (const row of m.dispositions) {
      const k = row.kind + ":" + row.id;
      if (dispositions.has(k) || !row.approval_refs.length)
        fail("migration_approval_missing");
      dispositions.set(k, row);
    }
    const consume = (kind, id) => {
      const key = kind + ":" + id,
        row = dispositions.get(key);
      if (!row) fail("migration_source_unmapped");
      dispositions.delete(key);
      return row;
    };
    if (
      new Set(claims.map((c) => c.claim_id)).size !== claims.length ||
      new Set(claims.filter(active).map((c) => c.issue_number)).size !==
        claims.filter(active).length
    )
      fail("migration_claim_conflict");
    const claimMap = new Map(claims.map((c) => [c.claim_id, c]));
    for (const c of claims) {
      const row = consume("claim", c.claim_id);
      if (active(c)) {
        if (row.disposition !== "retain" || !same(row.claim, c))
          fail("migration_active_claim_release");
      } else if (!["released", "retain"].includes(row.disposition))
        fail("migration_disposition_invalid");
    }
    for (const source of s.sources) {
      if (!source.machine) {
        const row = consume("manual", source.kind + ":" + source.id);
        if (row.disposition !== "not_claim" || row.claim !== null)
          fail("migration_manual_ambiguous");
      } else if (
        source.machine.record_kind === "claim" &&
        source.machine.record_status !== "released"
      ) {
        const c = claimMap.get(source.machine.claim_id);
        if (
          !c ||
          c.issue_number !== source.issue_number ||
          c.worker_id !== source.machine.worker_id ||
          c.generation !== source.machine.generation
        )
          fail("migration_machine_unmapped");
      }
    }
    for (const branch of s.branches.filter(
      (b) => b.name !== s.default_branch,
    )) {
      const row = consume("branch", branch.name);
      if (row.disposition === "retain") {
        if (
          !row.claim ||
          !claimMap.has(row.claim.claim_id) ||
          !same(row.claim, claimMap.get(row.claim.claim_id))
        )
          fail("migration_branch_unmapped");
      } else if (row.disposition !== "not_claim" || row.claim !== null)
        fail("migration_branch_unmapped");
    }
    for (const pr of s.prs) {
      const row = consume("pr", String(pr.number));
      if (row.disposition === "retain") {
        if (
          !row.claim ||
          !claimMap.has(row.claim.claim_id) ||
          !same(row.claim, claimMap.get(row.claim.claim_id))
        )
          fail("migration_pr_unmapped");
      } else if (row.disposition !== "not_claim" || row.claim !== null)
        fail("migration_pr_unmapped");
    }
    if (dispositions.size) fail("migration_unused_mapping");
    if (Buffer.byteLength(JSON.stringify(claims)) > 1000000)
      fail("output_limit");
    Object.assign(r, {
      status: "passed",
      configuration_digest: cfg.configuration_digest,
      manifest_digest: hash(m),
      imported_claims: structuredClone(claims),
    });
  } catch (e) {
    r.imported_claims = [];
    r.diagnostics = [code(e, "migration_input_invalid")];
  }
  return r;
}
