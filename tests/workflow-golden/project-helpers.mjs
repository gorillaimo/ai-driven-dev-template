import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { canonical, digest } from "../../tools/workflow-rules/resolve.mjs";
import { loadCase } from "../../tools/workflow-golden/load.mjs";
export const root = fileURLToPath(new URL("../../", import.meta.url));
export const fixtures = join(root, "tests/workflow-golden/fixtures");
export const all = [
  "project_plan",
  "project_members",
  "project_aggregate",
  "project_recommend",
];
const pa = ["project_plan", "project_aggregate", "project_recommend"],
  mr = ["project_members", "project_recommend"],
  ar = ["project_aggregate", "project_recommend"],
  mar = ["project_members", "project_aggregate", "project_recommend"];
// Independent contract, defined before implementing the adapters or recording snapshots.
export const projectCases = {
  "project-single-feature": {
    adapters: all,
    decision: "coordinator_candidates",
  },
  "project-dependency-wait": {
    adapters: pa,
    decision: "none",
    reason: "dependency_pending",
  },
  "project-dag-cycle": {
    adapters: pa,
    decision: "blocked",
    reason: "aggregate_blocked",
  },
  "project-unknown-feature": {
    adapters: pa,
    decision: "blocked",
    reason: "aggregate_blocked",
  },
  "project-area-serialization": {
    adapters: pa,
    decision: "coordinator_candidates",
  },
  "project-member-inactive": { adapters: mr, decision: "blocked" },
  "project-permission-denied": { adapters: mr, decision: "blocked" },
  "project-capacity-full": {
    adapters: mar,
    decision: "none",
    reason: "member_ineligible",
  },
  "project-team-mismatch": { adapters: mr, decision: "blocked" },
  "project-claim-request-a": {
    adapters: mar,
    decision: "coordinator_candidates",
  },
  "project-claim-request-b": {
    adapters: mar,
    decision: "coordinator_candidates",
  },
  "project-claim-owner-confirmed": {
    adapters: mar,
    decision: "none",
    reason: "other_owner",
  },
  "project-double-claim": {
    adapters: ar,
    decision: "blocked",
    reason: "aggregate_blocked",
  },
  "project-stale-claim": {
    adapters: ar,
    decision: "wait",
    reason: "claim_stale",
  },
  "project-events-first": { adapters: ar, decision: "resume" },
  "project-events-replay": { adapters: ar, decision: "resume" },
  "project-state-mismatch": {
    adapters: ar,
    decision: "blocked",
    reason: "aggregate_blocked",
  },
  "project-manual-fallback-paused": {
    adapters: all,
    decision: "wait",
    reason: "instruction_pause",
  },
  "project-manual-fallback-ready": {
    adapters: all,
    decision: "coordinator_candidates",
  },
  "project-unassigned-no-claim": {
    adapters: mar,
    decision: "coordinator_candidates",
  },
  "project-bot-owner-missing": {
    adapters: mr,
    decision: "blocked",
    reason: "schema_invalid",
  },
  "project-issues-only": { adapters: all, decision: "coordinator_candidates" },
  "project-managed-resume": { adapters: all, decision: "resume" },
  "project-approval-wait": {
    adapters: all,
    decision: "wait",
    reason: "own_wait",
  },
  "project-partial-inventory": {
    adapters: mar,
    decision: "blocked",
    reason: "inventory_unknown",
  },
};
export const clone = (v) => structuredClone(v);
export const getCase = (id) => loadCase(join(fixtures, id), id);
export const json = (v) => JSON.stringify(v);
export function treeDigest(dir) {
  const files = [];
  const visit = (d, p = "") => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const n = p + e.name;
      if (e.isDirectory()) visit(join(d, e.name), n + "/");
      else files.push([n, digest(readFileSync(join(d, e.name)))]);
    }
  };
  visit(dir);
  return digest(canonical(files));
}
export function assertBindings(c, outputs) {
  const r = c.inputs.project_recommend;
  for (const input of Object.values(c.inputs))
    for (const k of ["project", "deliveryPlan", "team"])
      if (input[k]) assert.deepEqual(input[k], r[k], c.manifest.id + ":" + k);
  if (c.inputs.project_aggregate)
    assert.deepEqual(c.inputs.project_aggregate, {
      project: r.project,
      deliveryPlan: r.deliveryPlan,
      ...r.aggregate,
    });
  const member = c.inputs.project_members;
  if (member) {
    for (const k of [
      "project_id",
      "repository",
      "project_revision",
      "team_revision",
      "project_digest",
      "team_digest",
      "observed_at",
      "evaluated_at",
      "freshness_limit_seconds",
      "recorded_by",
      "source",
      "principal",
      "member_facts",
      "claims_inventory_status",
      "active_claims",
    ])
      assert.deepEqual(member.context[k], r.context[k], k);
    const request = member.context.request,
      row = r.aggregate.context.issues.find(
        (x) => x.work_id === request.work_id,
      ),
      fact = r.context.issue_facts.find((x) => x.work_id === request.work_id);
    assert.equal(request.human_owner, r.context.human_owner);
    assert.equal(request.issue_ref, row.issue_ref);
    assert.deepEqual(request.assignees, row.assignees);
    for (const k of [
      "area_ids",
      "responsibility_confirmation",
      "owner_overrides",
    ])
      assert.deepEqual(request[k], fact[k]);
  }
  if (c.inputs.project_plan) {
    for (const k of [
      "project_id",
      "project_revision",
      "plan_revision",
      "project_digest",
      "plan_digest",
      "observed_at",
      "recorded_by",
      "source",
    ])
      assert.deepEqual(c.inputs.project_plan.context[k], r.context[k], k);
  }
  if (c.inputs.project_plan && outputs.project_aggregate?.status === "pass") {
    const facts = c.inputs.project_plan.context.feature_facts;
    assert.equal(facts.length, outputs.project_aggregate.features.length);
    for (const f of outputs.project_aggregate.features)
      assert.equal(
        facts.find((x) => x.feature_id === f.feature_id).state,
        ["ready", "planned"].includes(f.status) ? "planned" : f.status,
      );
    assert.deepEqual(
      c.inputs.project_plan.context.constraint_facts,
      r.aggregate.context.constraint_facts,
    );
  }
}
export function freeze(v) {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
