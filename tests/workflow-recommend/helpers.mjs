import {
  input as aggregateInput,
  managed as manage,
  active as activate,
  large,
  largeManaged,
  bind as bindAggregate,
  clone,
  ref,
  actor,
  fact,
  row,
  feature,
} from "../workflow-aggregate/helpers.mjs";
import { member, fact as memberFact } from "../workflow-members/helpers.mjs";
import { canonical, digest } from "../../tools/workflow-rules/resolve.mjs";
export { clone, ref, actor, fact, row, feature };
export const stamp = "2026-10-30T00:00:00Z";
export function issueFact(r) {
  return {
    issue_ref: r.issue_ref,
    work_id: r.work_id,
    area_ids: ["backend"],
    file_scope: ["packages/backend/src"],
    non_scope: ["packages/backend/private"],
    contract: { acceptance: fact(), non_scope: fact() },
    approval: fact(),
    responsibility_confirmation: fact(),
    owner_overrides: [],
    scope_check: { state: "clear", evidence: clone(ref) },
    execution_confirmation: { ...fact(), claim_id: null, agent_ref: null },
  };
}
export function bind(i) {
  bindAggregate({
    project: i.project,
    deliveryPlan: i.deliveryPlan,
    context: i.aggregate.context,
  });
  Object.assign(i.context, {
    project_id: i.project.project_id,
    repository: i.project.repository,
    project_revision: i.project.revision,
    plan_revision: i.deliveryPlan.revision,
    team_revision: i.team.revision,
    project_digest: digest(canonical(i.project)),
    plan_digest: digest(canonical(i.deliveryPlan)),
    team_digest: digest(canonical(i.team)),
  });
  return i;
}
export function input(a = aggregateInput()) {
  a.deliveryPlan.features.forEach((f) => (f.area_ids = ["backend"]));
  const m = member(
    "example-user",
    ["backend", "contracts"],
    ["developer", "coordinator"],
  );
  m.integration_owner = ["contracts"];
  const team = {
    schema_version: 1,
    artifact_kind: "team",
    project_id: a.project.project_id,
    revision: 1,
    updated_at: stamp,
    updated_by: clone(actor),
    membership_source: clone(a.project.membership_source),
    members: [m],
  };
  const context = {
    schema_version: 1,
    observed_at: stamp,
    evaluated_at: stamp,
    freshness_limit_seconds: 3600,
    recorded_by: clone(actor),
    source: clone(ref),
    human_owner: "example-user",
    agent_ref: "codex-a",
    principal: {
      credential_kind: "human",
      authenticated_login: "example-user",
      on_behalf_of: null,
      evidence: clone(ref),
      delegation: { state: "unknown", evidence: null },
    },
    member_facts: [memberFact("example-user")],
    claims_inventory_status: "complete",
    active_claims: [],
    instruction: { state: "proceed", evidence: clone(ref) },
    requested_issue_ref: null,
    candidate_limit: 3,
    issue_facts: a.context.issues.map(issueFact),
  };
  return bind({
    project: a.project,
    deliveryPlan: a.deliveryPlan,
    team,
    aggregate: { context: a.context, workflows: a.workflows },
    planning: { replan_decisions: [] },
    context,
  });
}
export function assigned() {
  return input(manage());
}
export function active() {
  const a = activate(manage());
  a.context.issues[0].claims[0].branch = a.workflows[0].input.state.git.branch;
  a.context.issues[0].branches[0].name = a.workflows[0].input.state.git.branch;
  const i = input(a);
  inventory(i);
  return i;
}
export function inventory(i) {
  i.context.active_claims = i.aggregate.context.issues.flatMap((r) =>
    r.claims
      .filter((c) => c.phase !== "released")
      .map((c) => ({
        claim_id: c.claim_id,
        issue_ref: r.issue_ref,
        work_id: r.work_id,
        human_owner: c.human_owner,
        evidence: clone(ref),
      })),
  );
  for (const f of i.context.issue_facts) {
    const c = i.context.active_claims.find((c) => c.work_id === f.work_id);
    if (c)
      f.execution_confirmation = {
        ...fact(),
        claim_id: c.claim_id,
        agent_ref: i.context.agent_ref,
      };
  }
  return i;
}
export function multi(ns = [10, 2]) {
  const i = input();
  i.deliveryPlan.features[0].issue_refs = ns.map((n) => ({
    issue_ref: row(n).issue_ref,
    work_id: "issue-" + n,
    required: true,
  }));
  i.aggregate.context.issues = ns.map((n) => row(n));
  i.context.issue_facts = i.aggregate.context.issues.map(issueFact);
  return bind(i);
}
export function hundred() {
  return input(large());
}
export const codes = (r) => [
  ...r.diagnostics.map((d) => d.code),
  ...r.excluded.flatMap((e) => e.reasons),
];
export function freeze(v) {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}

export function hundredManaged() {
  return input(largeManaged());
}
