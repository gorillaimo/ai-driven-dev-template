import { canonical, digest } from "workflow-rules/resolve";
import {
  fold,
  issueMatches,
  membershipSource,
  inspectMemberConfiguration,
  inspectMemberFacts,
  evaluateMember,
} from "./member-ownership.mjs";
export const within = (path, prefix) =>
  path === prefix || path.startsWith(prefix + "/");
export const overlap = (a, b) => within(a, b) || within(b, a);
export function inspectBindings(i, add) {
  const { project: p, deliveryPlan: d, team: t, context: c, aggregate: a } = i;
  if (
    p.project_id !== d.project_id ||
    t.project_id !== p.project_id ||
    c.project_id !== p.project_id ||
    fold(c.repository) !== fold(p.repository) ||
    c.project_revision !== p.revision ||
    c.plan_revision !== d.revision ||
    c.team_revision !== t.revision ||
    c.project_digest !== digest(canonical(p)) ||
    c.plan_digest !== digest(canonical(d)) ||
    c.team_digest !== digest(canonical(t)) ||
    canonical(membershipSource(p.membership_source)) !==
      canonical(membershipSource(t.membership_source))
  )
    add("context_mismatch");
  if (
    ["observed_at", "evaluated_at", "freshness_limit_seconds"].some(
      (k) => c[k] !== a.context?.[k],
    )
  )
    add("context_mismatch");
  const obs = Date.parse(c.observed_at),
    ev = Date.parse(c.evaluated_at);
  if (
    !Number.isFinite(obs) ||
    !Number.isFinite(ev) ||
    obs > ev ||
    ev - obs > c.freshness_limit_seconds * 1000 ||
    [p.updated_at, d.updated_at, t.updated_at].some(
      (v) => !Number.isFinite(Date.parse(v)) || Date.parse(v) > obs,
    )
  )
    add("snapshot_stale", "unknown");
  const login = fold(c.human_owner),
    principal = c.principal;
  const convert = (code, _path, _login, _area, kind = "invalid") =>
    add(
      kind === "unknown" ? "member_unknown" : "member_invalid",
      kind === "unknown" ? "unknown" : "invalid",
      null,
      "member",
      code,
    );
  const model = inspectMemberConfiguration(
      p,
      t,
      { area_ids: [], assignees: [] },
      convert,
    ),
    facts = inspectMemberFacts(c, model, convert);
  evaluateMember(login, p, model, facts, convert, "context/human_owner");
  if (!model.members.get(login)?.roles.includes("developer"))
    add("member_ineligible", "ineligible", null, "member", "role_missing");
  if (
    principal.credential_kind === "unknown" ||
    !principal.authenticated_login ||
    !principal.evidence
  )
    add("principal_unknown", "unknown");
  else if (principal.credential_kind === "human") {
    if (
      fold(principal.authenticated_login) !== login ||
      (principal.on_behalf_of && fold(principal.on_behalf_of) !== login)
    )
      add("principal_mismatch");
  } else {
    if (
      !principal.on_behalf_of ||
      principal.delegation.state === "unknown" ||
      !principal.delegation.evidence
    )
      add("delegation_unknown", "unknown");
    if (principal.delegation.state === "denied")
      add("delegation_denied", "ineligible");
    if (
      (principal.on_behalf_of && fold(principal.on_behalf_of) !== login) ||
      model.members.has(fold(principal.authenticated_login))
    )
      add("principal_mismatch");
  }
  const recorder = c.recorded_by;
  if (recorder.actor_type === "ai_agent" || recorder.actor_type === "bot") {
    if (
      recorder.actor_ref !== c.agent_ref ||
      fold(recorder.on_behalf_of ?? "") !== login
    )
      add("recorder_mismatch");
  } else if (
    recorder.actor_type !== "human" ||
    fold(recorder.actor_ref) !== login
  )
    add("recorder_mismatch");
  if (c.claims_inventory_status !== "complete")
    add("inventory_unknown", "unknown");
  const expected = new Map(),
    rows = new Map(),
    features = new Map(d.features.map((f) => [f.feature_id, f]));
  for (const f of d.features)
    for (const r of f.issue_refs) {
      if (
        expected.has(r.work_id) ||
        !issueMatches(r.issue_ref, r.work_id, p.repository) ||
        !Number.isSafeInteger(Number(r.work_id.slice(6)))
      )
        add("issue_facts_mismatch");
      expected.set(r.work_id, { ...r, feature_id: f.feature_id });
    }
  const supplemental = new Map();
  for (const f of c.issue_facts) {
    const e = expected.get(f.work_id);
    if (
      supplemental.has(f.work_id) ||
      !e ||
      fold(e.issue_ref) !== fold(f.issue_ref)
    ) {
      add("issue_facts_mismatch");
      continue;
    }
    supplemental.set(f.work_id, f);
    const feature = features.get(e.feature_id);
    if (
      new Set(f.area_ids).size !== f.area_ids.length ||
      f.area_ids.some(
        (id) => !feature.area_ids.includes(id) || !model.areas.has(id),
      )
    )
      add("scope_binding", "invalid", f.work_id);
    const paths = f.area_ids.flatMap((id) => model.areas.get(id)?.paths ?? []);
    if (
      [...f.file_scope, ...f.non_scope].some(
        (path) => !paths.some((prefix) => within(path, prefix)),
      ) ||
      f.file_scope.some((path) =>
        f.non_scope.some((other) => overlap(path, other)),
      )
    )
      add("scope_binding", "invalid", f.work_id);
  }
  for (const work of expected.keys())
    if (!supplemental.has(work)) add("issue_facts_mismatch");
  const claims = new Map();
  if (Array.isArray(a.context?.issues))
    for (const row of a.context.issues) {
      const expectedRow = expected.get(row.work_id);
      if (
        !expectedRow ||
        rows.has(row.work_id) ||
        expectedRow.feature_id !== row.feature_id ||
        fold(expectedRow.issue_ref) !== fold(row.issue_ref)
      ) {
        add("issue_facts_mismatch");
        continue;
      }
      rows.set(row.work_id, row);
      for (const claim of row.claims ?? [])
        if (claim.phase !== "released") {
          if (claims.has(claim.claim_id)) add("inventory_mismatch");
          claims.set(claim.claim_id, {
            claim_id: claim.claim_id,
            issue_ref: row.issue_ref,
            work_id: row.work_id,
            human_owner: claim.human_owner,
          });
        }
    }
  const ids = new Set();
  for (const claim of c.active_claims) {
    if (!expected.has(claim.work_id)) {
      add("untracked_claim");
      continue;
    }
    const original = claims.get(claim.claim_id);
    if (
      ids.has(claim.claim_id) ||
      !original ||
      original.work_id !== claim.work_id ||
      fold(original.issue_ref) !== fold(claim.issue_ref) ||
      fold(original.human_owner) !== fold(claim.human_owner)
    )
      add("inventory_mismatch");
    ids.add(claim.claim_id);
  }
  for (const id of claims.keys()) if (!ids.has(id)) add("inventory_mismatch");
  return { model, facts, expected, rows, features, supplemental };
}
export function derivePlanInput(i, aggregate) {
  const c = i.context,
    a = i.aggregate.context;
  const feature_facts = aggregate.features.map((f) => {
    const state = ["ready", "planned"].includes(f.status)
      ? "planned"
      : f.status;
    const row = a.issues.find((r) => r.feature_id === f.feature_id),
      confirmation = a.feature_confirmations.find(
        (x) => x.feature_id === f.feature_id,
      );
    return {
      feature_id: f.feature_id,
      state,
      ...(state === "planned"
        ? {}
        : {
            evidence:
              state === "cancelled"
                ? (confirmation?.cancellation?.reference ??
                  row?.source ??
                  c.source)
                : state === "completed"
                  ? (confirmation?.acceptance.evidence ??
                    row?.source ??
                    c.source)
                  : (row?.source ?? c.source),
          }),
    };
  });
  return {
    project: i.project,
    deliveryPlan: i.deliveryPlan,
    context: {
      schema_version: 1,
      project_id: c.project_id,
      project_revision: c.project_revision,
      plan_revision: c.plan_revision,
      project_digest: c.project_digest,
      plan_digest: c.plan_digest,
      observed_at: c.observed_at,
      recorded_by: c.recorded_by,
      source: c.source,
      feature_facts,
      constraint_facts: a.constraint_facts,
      replan_decisions: i.planning.replan_decisions,
    },
    ...(i.planning.previous !== undefined
      ? { previous: i.planning.previous }
      : {}),
  };
}
