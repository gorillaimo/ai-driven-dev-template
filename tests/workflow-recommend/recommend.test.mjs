import test from "node:test";
import assert from "node:assert/strict";
import {
  recommendNextWork,
  validateRecommendationArtifact,
} from "../../tools/workflow-project/recommend.mjs";
import { checkWorkflow } from "../../tools/workflow-check/check.mjs";
import { event, finish } from "../workflow-check/fixtures/build.mjs";
import {
  input,
  assigned,
  active,
  multi,
  bind,
  inventory,
  clone,
  ref,
  fact,
  codes,
  freeze,
  row,
  issueFact,
} from "./helpers.mjs";
const run = (i) => {
  const r = recommendNextWork(i);
  assert.equal(validateRecommendationArtifact("result", r).valid, true);
  return r;
};
const blocked = (i) => {
  const r = run(i);
  assert.equal(r.status, "blocked", JSON.stringify(r));
  assert.equal(r.selected_action, null);
  assert.deepEqual(r.coordinator_candidates, []);
  return r;
};
test("AC1/6 legacy unassigned offers Coordinator consultation, never assignment", () => {
  const r = run(input());
  assert.equal(r.status, "pass");
  assert.equal(r.decision, "coordinator_candidates");
  assert.equal(r.selected_action.kind, "ask_coordinator");
  assert.equal(r.selected_action.next_stage, null);
  assert.equal(r.selected_action.requires_human_confirmation, true);
  assert.equal(r.selected_action.requires_runtime_recheck, true);
  assert.equal(r.coordinator_candidates.length, 1);
});
test("AC3/4 assigned managed requests claim without stage execution", () => {
  const r = run(assigned());
  assert.equal(r.decision, "claim_request", JSON.stringify(r));
  assert.equal(r.selected_action.kind, "request_claim");
  assert.equal(r.selected_action.next_stage, null);
});
test("AC3 actual workflow candidate is used for self +0 resume", () => {
  const i = active(),
    w = i.aggregate.workflows[0].input,
    expected = checkWorkflow(w);
  assert.equal(expected.status, "pass");
  const r = run(i);
  assert.equal(r.decision, "resume", JSON.stringify(r));
  assert.equal(r.selected_action.next_stage, expected.next_stage);
  assert.equal(r.selected_action.claim_id, "claim-a");
  assert.equal(r.selected_action.rank.wave, null);
});
test("AC4 legacy assigned requires manual review", () => {
  const i = assigned();
  i.aggregate.context.issues[0].workflow_mode = "legacy";
  i.aggregate.workflows = [];
  const r = run(i);
  assert.equal(r.decision, "wait");
  assert.ok(codes(r).includes("manual_review"));
});
test("AC4 running stage waits and does not infer completion", () => {
  const i = active(),
    w = i.aggregate.workflows[0].input;
  event(w, "stage_started", "intake");
  w.state.next_stage = null;
  w.previous = { plan: clone(w.plan), state: clone(w.state) };
  const r = run(i);
  assert.equal(r.decision, "wait", JSON.stringify(r));
  assert.equal(r.current_work.current_stage, "intake");
  assert.equal(r.selected_action, null);
});
test("AC4 assigned highest blocked is not skipped for lower candidate", () => {
  const i = multi();
  for (const r of i.aggregate.context.issues) {
    r.labels = [i.project.status_mapping.assigned];
    r.assignees = ["example-user"];
    r.human_owner = "example-user";
  }
  i.context.issue_facts.find((f) => f.work_id === "issue-2").approval =
    fact("denied");
  const r = run(i);
  assert.equal(r.current_work.work_id, "issue-2");
  assert.equal(r.selected_action, null);
  assert.deepEqual(r.coordinator_candidates, []);
});
test("AC4 requested failure never selects another Issue", () => {
  const i = multi();
  i.context.requested_issue_ref = row(10).issue_ref;
  i.context.issue_facts.find((f) => f.work_id === "issue-10").approval =
    fact("denied");
  const r = run(i);
  assert.equal(r.selected_action, null);
  assert.ok(r.excluded.some((e) => e.work_id === "issue-10"));
});
test("AC4 explicit unassigned remains Coordinator only", () => {
  const i = multi();
  i.context.requested_issue_ref = row(10).issue_ref;
  const r = run(i);
  assert.equal(r.selected_action.work_id, "issue-10");
  assert.equal(r.selected_action.kind, "ask_coordinator");
});
test("AC4 untracked requested Issue stops", () => {
  const i = input();
  i.context.requested_issue_ref = row(999).issue_ref;
  blocked(i);
});
test("AC5 stable numeric Issue order #2 before #10", () => {
  const r = run(multi());
  assert.deepEqual(
    r.coordinator_candidates.map((c) => c.work_id),
    ["issue-2", "issue-10"],
  );
});
test("AC5 explicit candidate limit truncates only eligible ranked candidates", () => {
  const i = multi([10, 3, 2]);
  i.context.candidate_limit = 2;
  assert.deepEqual(
    run(i).coordinator_candidates.map((c) => c.work_id),
    ["issue-2", "issue-3"],
  );
});
test("AC7 deterministic selection under permitted row reorder", () => {
  const i = multi([10, 3, 2]),
    j = clone(i);
  j.aggregate.context.issues.reverse();
  j.context.issue_facts.reverse();
  j.deliveryPlan.features[0].issue_refs.reverse();
  bind(j);
  assert.deepEqual(
    run(i).coordinator_candidates,
    run(j).coordinator_candidates,
  );
  assert.deepEqual(run(i), run(i));
});
test("AC7 frozen input unchanged", () => {
  const i = freeze(active()),
    before = JSON.stringify(i);
  run(i);
  assert.equal(JSON.stringify(i), before);
});
for (const state of ["stop", "pause", "replan_required"])
  test("AC4 human instruction " + state, () => {
    const i = active();
    i.context.instruction.state = state;
    const r = run(i);
    assert.equal(r.selected_action, null);
    assert.ok(codes(r).includes("instruction_" + state));
  });
for (const state of ["partial", "unknown"])
  test("AC2 claim inventory " + state, () => {
    const i = input();
    i.context.claims_inventory_status = state;
    blocked(i);
  });
for (const k of ["project_digest", "plan_digest", "team_digest"])
  test("AC2 original binding " + k, () => {
    const i = input();
    i.context[k] = "f".repeat(64);
    blocked(i);
  });
for (const k of ["project_revision", "plan_revision", "team_revision"])
  test("AC2 revision binding " + k, () => {
    const i = input();
    i.context[k]++;
    blocked(i);
  });
for (const k of ["observed_at", "evaluated_at"])
  test("AC2 aggregate clock binding " + k, () => {
    const i = input();
    i.context[k] = "2026-10-30T00:01:00Z";
    blocked(i);
  });
test("AC2 freshness mismatch", () => {
  const i = input();
  i.context.freshness_limit_seconds = 2;
  blocked(i);
});
test("AC2 stale snapshot", () => {
  const i = input();
  i.context.evaluated_at = i.aggregate.context.evaluated_at =
    "2026-10-31T00:00:00Z";
  blocked(i);
});
test("AC2 team newer than snapshot", () => {
  const i = input();
  i.team.updated_at = "2026-10-31T00:00:00Z";
  bind(i);
  blocked(i);
});
for (const mutate of [
  (i) => (i.context.principal.authenticated_login = "other"),
  (i) => (i.context.principal.credential_kind = "unknown"),
  (i) => (i.context.principal.evidence = null),
  (i) => (i.context.member_facts[0].account_type = "bot"),
  (i) => (i.context.member_facts[0].repository_access.permission = "read"),
  (i) => (i.team.members[0].active = false),
  (i) => (i.team.members[0].roles = ["coordinator"]),
  (i) => (i.context.member_facts = []),
])
  test("AC2 base human qualification " + mutate.toString(), () => {
    const i = input();
    mutate(i);
    bind(i);
    blocked(i);
  });
test("AC2 bot explicit delegation can propose", () => {
  const i = input();
  Object.assign(i.context.principal, {
    credential_kind: "bot",
    authenticated_login: "helper[bot]",
    on_behalf_of: "example-user",
    delegation: fact(),
  });
  assert.equal(run(i).decision, "coordinator_candidates");
});
for (const state of ["denied", "unknown"])
  test("AC2 bot delegation " + state, () => {
    const i = input();
    Object.assign(i.context.principal, {
      credential_kind: "bot",
      authenticated_login: "helper[bot]",
      on_behalf_of: "example-user",
      delegation: fact(state),
    });
    blocked(i);
  });
test("AC2 human case folding", () => {
  const i = input();
  i.context.human_owner = "EXAMPLE-USER";
  assert.equal(run(i).decision, "coordinator_candidates");
});
for (const change of [
  (i) => (i.context.active_claims = []),
  (i) => (i.context.active_claims[0].human_owner = "other"),
  (i) => (i.context.active_claims[0].claim_id = "other"),
  (i) => i.context.active_claims.push(clone(i.context.active_claims[0])),
])
  test("AC2 inventory exact " + change.toString(), () => {
    const i = active();
    change(i);
    blocked(i);
  });
test("AC2 untracked claim cannot disappear from capacity", () => {
  const i = input();
  i.context.active_claims.push({
    claim_id: "unknown",
    issue_ref: row(99).issue_ref,
    work_id: "issue-99",
    human_owner: "example-user",
    evidence: clone(ref),
  });
  assert.ok(codes(blocked(i)).includes("untracked_claim"));
});
for (const change of [
  (f) => (f.execution_confirmation.agent_ref = "other-agent"),
  (f) => (f.execution_confirmation.claim_id = "other-claim"),
  (f) => (f.execution_confirmation.state = "unknown"),
  (f) => (f.execution_confirmation.state = "denied"),
  (f) => (f.execution_confirmation.evidence = null),
])
  test("AC2 agent handoff " + change.toString(), () => {
    const i = active();
    change(i.context.issue_facts[0]);
    assert.equal(run(i).selected_action, null);
  });
for (const change of [
  (i) => (i.context.issue_facts = []),
  (i) => i.context.issue_facts.push(clone(i.context.issue_facts[0])),
  (i) => (i.context.issue_facts[0].work_id = "issue-2"),
  (i) => (i.context.issue_facts[0].area_ids = ["contracts"]),
  (i) => (i.context.issue_facts[0].file_scope = ["docs/api"]),
  (i) => (i.context.issue_facts[0].non_scope = ["../escape"]),
])
  test("AC2 supplement binding " + change.toString(), () => {
    const i = input();
    change(i);
    blocked(i);
  });
for (const [field, state] of [
  ["acceptance", "denied"],
  ["non_scope", "denied"],
  ["acceptance", "unknown"],
])
  test("AC5 contract " + field + " " + state, () => {
    const i = input();
    i.context.issue_facts[0].contract[field] = fact(state);
    assert.equal(run(i).selected_action, null);
  });
for (const state of ["denied", "unknown"])
  test("AC5 current approval " + state, () => {
    const i = input();
    i.context.issue_facts[0].approval = fact(state);
    assert.equal(run(i).selected_action, null);
  });
for (const state of ["conflict", "unknown"])
  test("AC5 scope check " + state, () => {
    const i = input();
    i.context.issue_facts[0].scope_check.state = state;
    assert.equal(run(i).selected_action, null);
  });
test("AC4 normal blocked status remains wait", () => {
  const i = assigned(),
    r = i.aggregate.context.issues[0];
  r.labels = [i.project.status_mapping.blocked];
  r.blockers = [clone(ref)];
  i.aggregate.workflows = [];
  r.workflow_mode = "legacy";
  assert.equal(run(i).decision, "wait");
});
test("AC4 human review waits without taking available Issue", () => {
  const i = multi([1, 2]),
    r = i.aggregate.context.issues[0];
  r.human_owner = "example-user";
  r.assignees = ["example-user"];
  r.labels = [i.project.status_mapping.in_review];
  r.review = { kind: "design", reference: clone(ref) };
  const out = run(i);
  assert.equal(out.decision, "wait");
  assert.equal(out.current_work.work_id, "issue-1");
  assert.deepEqual(out.coordinator_candidates, []);
});
test("AC4 other owner not self through collaborator assignee", () => {
  const i = input(),
    r = i.aggregate.context.issues[0];
  r.labels = [i.project.status_mapping.assigned];
  r.human_owner = "other";
  r.assignees = ["other", "example-user"];
  const out = run(i);
  assert.equal(out.selected_action, null);
  assert.ok(codes(out).includes("other_owner"));
});
test("AC3 aggregate mismatch stops globally", () => {
  const i = multi();
  i.aggregate.context.issues[1].labels = ["project:completed"];
  blocked(i);
});
test("AC3 DAG unknown is blocked by original checker", () => {
  const i = input();
  i.deliveryPlan.features[0].depends_on = [
    { feature_id: "unknown", reason: "dependency" },
  ];
  bind(i);
  blocked(i);
});
test("AC3 DAG cycle blocked", () => {
  const i = input();
  i.deliveryPlan.features[0].depends_on = [
    { feature_id: "a", reason: "cycle" },
  ];
  bind(i);
  blocked(i);
});
test("AC3 revised plan missing previous blocks", () => {
  const i = input();
  i.deliveryPlan.revision = 2;
  bind(i);
  blocked(i);
});
test("AC5 legacy facts unknown on unrelated completed work need not be fabricated", () => {
  const i = input();
  i.context.issue_facts[0].execution_confirmation = {
    ...fact("unknown"),
    claim_id: null,
    agent_ref: null,
  };
  assert.equal(run(i).decision, "coordinator_candidates");
});
test("AC3 no Issues still checks human", () => {
  const i = input();
  i.deliveryPlan.features = [];
  i.aggregate.context.issues = [];
  i.aggregate.context.feature_confirmations = [];
  i.context.issue_facts = [];
  bind(i);
  assert.equal(run(i).decision, "none");
  i.context.principal.authenticated_login = "wrong";
  blocked(i);
});
test("AC6 output result rejects unknown core", () => {
  const r = run(input());
  r.extra = true;
  assert.equal(validateRecommendationArtifact("result", r).valid, false);
});
test("AC1 context rejects missing explicit limits and future version", () => {
  const i = input();
  assert.equal(
    validateRecommendationArtifact("context", i.context).valid,
    true,
  );
  delete i.context.candidate_limit;
  assert.equal(
    validateRecommendationArtifact("context", i.context).valid,
    false,
  );
  i.context.candidate_limit = 3;
  i.context.schema_version = 2;
  assert.equal(
    validateRecommendationArtifact("context", i.context).valid,
    false,
  );
});
function addFeature(i, n = 2, id = "b", area = "backend") {
  const r = row(n, id),
    f = {
      ...clone(i.deliveryPlan.features[0]),
      feature_id: id,
      depends_on: [],
      area_ids: [area],
      issue_refs: [
        { issue_ref: r.issue_ref, work_id: r.work_id, required: true },
      ],
    };
  i.deliveryPlan.features.push(f);
  i.aggregate.context.issues.push(r);
  i.aggregate.context.feature_confirmations.push({
    feature_id: id,
    acceptance: fact("unknown"),
    cancellation: null,
  });
  const supplement = issueFact(r);
  supplement.area_ids = [area];
  if (area === "contracts") {
    supplement.file_scope = ["docs/api"];
    supplement.non_scope = ["docs/architecture.md"];
  }
  i.context.issue_facts.push(supplement);
  return bind(i);
}
test("AC5 wave precedes numeric Issue tie-break", () => {
  const i = multi([10]);
  addFeature(i, 2);
  const r = run(i);
  assert.deepEqual(
    r.coordinator_candidates.map((x) => [x.work_id, x.rank.wave]),
    [
      ["issue-10", 1],
      ["issue-2", 2],
    ],
  );
});
test("AC5 approved priority precedes wave and Issue number", () => {
  const i = multi([10]);
  i.deliveryPlan.features[0].planned_priority = 2;
  addFeature(i, 2);
  i.deliveryPlan.features[1].planned_priority = 1;
  bind(i);
  assert.equal(run(i).selected_action.work_id, "issue-2");
});
test("AC5 active feature candidate retains explicit null wave after numbered waves", () => {
  const i = multi([10]);
  addFeature(i, 2, "b", "contracts");
  const r = row(3, "b");
  r.labels = [i.project.status_mapping.assigned];
  r.human_owner = "other";
  r.assignees = ["other"];
  i.deliveryPlan.features[1].issue_refs.push({
    issue_ref: r.issue_ref,
    work_id: r.work_id,
    required: false,
  });
  i.aggregate.context.issues.push(r);
  const supplement = issueFact(r);
  supplement.area_ids = ["contracts"];
  supplement.file_scope = ["docs/api"];
  supplement.non_scope = [];
  i.context.issue_facts.push(supplement);
  bind(i);
  const out = run(i);
  assert.deepEqual(
    out.coordinator_candidates.map((x) => [x.work_id, x.rank.wave]),
    [
      ["issue-10", 1],
      ["issue-2", null],
    ],
  );
});
test("AC5 unfinished feature dependency is not satisfied by future wave", () => {
  const i = input();
  addFeature(i);
  i.deliveryPlan.features[1].depends_on = [
    { feature_id: "a", reason: "finish a first" },
  ];
  bind(i);
  const r = run(i);
  assert.deepEqual(
    r.coordinator_candidates.map((x) => x.work_id),
    ["issue-1"],
  );
  assert.ok(codes(r).includes("dependency_pending"));
});
for (const state of ["pending", "unknown", "satisfied"])
  test("AC5 actual constraint " + state, () => {
    const i = input();
    i.deliveryPlan.features[0].constraints = [
      { kind: "approval", reference: clone(ref), reason: "human gate" },
    ];
    i.aggregate.context.constraint_facts = [
      {
        feature_id: "a",
        constraint_index: 0,
        state,
        ...(state === "satisfied" ? { evidence: clone(ref) } : {}),
      },
    ];
    bind(i);
    const r = run(i);
    assert.equal(!!r.selected_action, state === "satisfied", JSON.stringify(r));
  });
test("AC5 completed predecessor permits successor", () => {
  const i = input(),
    row1 = i.aggregate.context.issues[0];
  row1.github_state = "closed";
  row1.labels = [i.project.status_mapping.completed];
  row1.completion = fact();
  i.aggregate.context.feature_confirmations[0].acceptance = fact();
  addFeature(i);
  i.deliveryPlan.features[1].depends_on = [
    { feature_id: "a", reason: "confirmed completion" },
  ];
  bind(i);
  assert.equal(run(i).selected_action.work_id, "issue-2");
});
for (const state of ["active", "prepared", "unknown"])
  test("AC4 unreleased " + state + " claim never enables new work", () => {
    const i = active();
    i.aggregate.context.issues[0].claims[0].phase = state;
    inventory(i);
    addFeature(i, 2, "b", "contracts");
    const r = run(i);
    assert.notEqual(r.selected_action?.work_id, "issue-2");
    if (state !== "active") assert.equal(r.selected_action, null);
  });
for (const prefix of ["packages/backend", "packages/backend/src"])
  test("AC5 other unreleased claim area prefix conflict " + prefix, () => {
    const i = active();
    i.aggregate.context.issues[0].workflow_mode = "legacy";
    i.aggregate.workflows = [];
    i.aggregate.context.issues[0].human_owner = "other";
    i.aggregate.context.issues[0].assignees = ["other"];
    i.aggregate.context.issues[0].claims[0].human_owner = "other";
    addFeature(i);
    i.project.areas.push({
      area_id: "child",
      paths: [prefix],
      shared: false,
      integration_owner: null,
      conflict_policy: "disjoint_scopes",
    });
    i.deliveryPlan.features[1].area_ids = ["child"];
    i.team.members[0].areas.push("child");
    const f = i.context.issue_facts.find((f) => f.work_id === "issue-2");
    f.area_ids = ["child"];
    f.non_scope = [];
    inventory(i);
    bind(i);
    const r = run(i);
    assert.equal(r.selected_action, null);
    assert.ok(codes(r).includes("scope_conflict"));
  });
test("AC5 scope conflict cannot be cleared with disjoint_scopes/clear fact", () => {
  const i = active();
  addFeature(i);
  i.context.requested_issue_ref = row(2).issue_ref;
  i.team.members[0].max_concurrent_issues = 2;
  bind(i);
  const out = run(i);
  assert.ok(codes(out).includes("scope_conflict"));
  assert.equal(out.selected_action, null);
});
test("AC5 +1 new work respects full capacity, self +0 already covered", () => {
  const i = active();
  addFeature(i, 2, "b", "contracts");
  i.context.requested_issue_ref = row(2).issue_ref;
  const r = run(i);
  assert.ok(r.diagnostics.some((d) => d.source_code === "capacity_exceeded"));
  assert.equal(r.selected_action, null);
  i.team.members[0].max_concurrent_issues = 2;
  bind(i);
  assert.equal(run(i).selected_action?.work_id, "issue-2");
});
test("AC5 open PR on another area blocks ancestor-prefix candidate", () => {
  const i = active();
  const r = i.aggregate.context.issues[0];
  r.workflow_mode = "legacy";
  i.aggregate.workflows = [];
  r.labels = [i.project.status_mapping.in_review];
  r.review = { kind: "pr", reference: clone(ref) };
  r.human_owner = "other";
  r.assignees = ["other"];
  r.claims[0].human_owner = "other";
  r.prs = [
    {
      number: 4,
      head_branch: r.claims[0].branch,
      head_commit: r.branches[0].head_commit,
      base_branch: "main",
      state: "open",
      evidence: clone(ref),
    },
  ];
  addFeature(i);
  inventory(i);
  const out = run(i);
  assert.equal(out.selected_action, null);
  assert.ok(codes(out).includes("scope_conflict"));
});
test("AC3 stale claim warns and waits without automatic release", () => {
  const i = active();
  i.aggregate.context.issues[0].claims[0].claimed_at = "2026-10-28T00:00:00Z";
  i.aggregate.context.issues[0].claims[0].last_heartbeat_at =
    "2026-10-28T00:00:00Z";
  const before = JSON.stringify(i);
  const r = run(i);
  assert.equal(r.decision, "wait");
  assert.ok(codes(r).includes("claim_stale"));
  assert.equal(JSON.stringify(i), before);
});
test("AC2 missing required Organization Team stops even when no candidate", () => {
  const i = input();
  i.project.membership_source.organization_team = {
    organization: "example",
    team_slug: "dev",
  };
  i.team.membership_source = clone(i.project.membership_source);
  bind(i);
  blocked(i);
});
test("AC2 missing coordinator permission excludes candidate", () => {
  const i = input();
  i.project.coordinators.assignments[0].github_login = "coord";
  const m = clone(i.team.members[0]);
  m.github_login = "coord";
  m.roles = ["coordinator"];
  m.integration_owner = [];
  i.team.members.push(m);
  const f = clone(i.context.member_facts[0]);
  f.github_login = "coord";
  f.repository_access.permission = "read";
  i.context.member_facts.push(f);
  bind(i);
  const out = run(i);
  assert.equal(out.selected_action, null);
  assert.ok(
    out.diagnostics.some((d) => d.source_code === "permission_insufficient"),
  );
});
test("AC2 invalid integration owner override cannot authorize candidate", () => {
  const i = input();
  i.context.issue_facts[0].owner_overrides = [
    {
      area_id: "backend",
      github_login: "example-user",
      issue_ref: row(1).issue_ref,
      work_id: "issue-1",
      approval: {
        approval_type: "wrong",
        approved_by: "example-user",
        approved_at: i.context.observed_at,
        reference: clone(ref),
      },
    },
  ];
  const out = run(i);
  assert.equal(out.selected_action, null);
  assert.ok(
    out.diagnostics.some((d) => d.source_code === "override_approval_invalid"),
  );
});
test("AC4 in-progress outranks assigned regardless of numeric order", () => {
  const i = active();
  addFeature(i, 2, "b", "contracts");
  const r = i.aggregate.context.issues[1];
  r.labels = [i.project.status_mapping.assigned];
  r.human_owner = "example-user";
  r.assignees = ["example-user"];
  i.context.issue_facts[1].approval = fact("unknown");
  assert.equal(run(i).selected_action?.work_id, "issue-1");
});
test("AC3 raw workflow corruption is rerun, not saved projection trusted", () => {
  const i = active();
  i.aggregate.workflows[0].input.state.work_id = "issue-2";
  blocked(i);
});
test("AC3 saved results are rejected as core extras", () => {
  const i = input();
  i.aggregate.result = { status: "pass" };
  blocked(i);
});
test("AC4 safe retry denial stays waiting after resume-only failure", () => {
  const i = active();
  const w = i.aggregate.workflows[0].input;
  finish(w, "intake");
  w.state.next_stage = "context";
  w.previous = { plan: clone(w.plan), state: clone(w.state) };
  w.state.resume.safe_to_retry = false;
  const r = run(i);
  assert.equal(r.decision, "wait");
  assert.ok(r.diagnostics.some((d) => d.source === "workflow"));
});

test("AC5 confirmed cancelled feature is not a new-work candidate", () => {
  const i = input();
  i.aggregate.context.feature_confirmations[0].cancellation = {
    approval_type: "cancel",
    approved_by: "example-user",
    approved_at: i.context.observed_at,
    reference: clone(ref),
  };
  const r = run(i);
  assert.equal(r.selected_action, null);
  assert.ok(codes(r).includes("terminal_work"));
});
for (const decision of ["pause", "cancel"])
  test("AC3 approved feature replan " + decision + " holds candidate", () => {
    const i = input();
    i.planning.replan_decisions = [
      {
        feature_id: "a",
        decision,
        approval: {
          approval_type: "project_replan",
          approved_by: "example-user",
          approved_at: i.context.observed_at,
          reference: clone(ref),
        },
      },
    ];
    assert.equal(run(i).selected_action, null);
  });

test("AC5 blocked feature does not start a new optional Issue", () => {
  const i = multi([1, 2]);
  i.deliveryPlan.features[0].issue_refs[1].required = false;
  const r = i.aggregate.context.issues[0];
  r.labels = [i.project.status_mapping.blocked];
  r.blockers = [clone(ref)];
  bind(i);
  assert.equal(run(i).selected_action, null);
});
test("AC5 cancelled required Issue does not allow optional follow-on work", () => {
  const i = multi([1, 2]);
  i.deliveryPlan.features[0].issue_refs[1].required = false;
  const r = i.aggregate.context.issues[0];
  r.labels = [i.project.status_mapping.cancelled];
  r.github_state = "closed";
  r.cancellation = {
    approval_type: "cancel",
    approved_by: "example-user",
    approved_at: i.context.observed_at,
    reference: clone(ref),
  };
  bind(i);
  assert.equal(run(i).selected_action, null);
});
