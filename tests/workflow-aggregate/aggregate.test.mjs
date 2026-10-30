import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateProject,
  validateAggregateArtifact,
} from "../../tools/workflow-project/aggregate.mjs";
import {
  input,
  bind,
  clone,
  active,
  completed,
  managed,
  status,
  fact,
  approval,
  ref,
  event,
  large,
  feature,
  row,
  largeManaged,
} from "./helpers.mjs";
const has = (r, code) =>
  assert.ok(
    r.diagnostics.some((d) => d.code === code),
    JSON.stringify(r.diagnostics),
  );
function blocked(i, code) {
  const r = aggregateProject(i);
  assert.equal(r.status, "blocked");
  if (code) has(r, code);
  assert.equal(validateAggregateArtifact("result", r).valid, true);
  return r;
}
export { blocked };
test("legacy ready, actual status retained, no authority or side effect", () => {
  const i = input(),
    before = clone(i),
    r = aggregateProject(i);
  assert.equal(r.status, "pass");
  assert.equal(r.features[0].status, "ready");
  assert.equal(r.issues[0].observed_project_status, "available_for_work");
  assert.ok(r.not_evaluated.includes("legacy_workflow"));
  assert.deepEqual(i, before);
  assert.deepEqual(r, aggregateProject(i));
});
test("feature completion requires human acceptance and required nonempty issues", () => {
  const i = completed();
  assert.equal(aggregateProject(i).features[0].status, "completed");
  i.context.feature_confirmations[0].acceptance = fact("unknown");
  assert.equal(aggregateProject(i).features[0].status, "unknown");
  i.deliveryPlan.features[0].issue_refs = [];
  i.context.issues = [];
  bind(i);
  assert.equal(aggregateProject(i).features[0].status, "planned");
});
for (const [name, mutate, code] of [
  [
    "partial",
    (i) => (i.context.collection_status = "partial"),
    "collection_unknown",
  ],
  ["missing issue", (i) => (i.context.issues = []), "issue_missing"],
  ["extra issue", (i) => i.context.issues.push(row(2)), "issue_unknown"],
  [
    "duplicate issue",
    (i) => i.context.issues.push(clone(i.context.issues[0])),
    "duplicate_issue",
  ],
  [
    "digest",
    (i) => (i.context.project_digest = "f".repeat(64)),
    "context_mismatch",
  ],
  ["revision", (i) => i.context.plan_revision++, "context_mismatch"],
  [
    "repository",
    (i) => (i.context.repository = "other/project"),
    "context_mismatch",
  ],
  [
    "identity",
    (i) => (i.context.issues[0].work_id = "issue-2"),
    "issue_identity",
  ],
  [
    "feature",
    (i) => (i.context.issues[0].feature_id = "missing"),
    "issue_identity",
  ],
  [
    "stale",
    (i) => (i.context.evaluated_at = "2026-10-30T02:00:00Z"),
    "snapshot_stale",
  ],
  [
    "future",
    (i) => (i.context.issues[0].observed_at = "2026-10-31T00:00:00Z"),
    "snapshot_stale",
  ],
  [
    "row stale",
    (i) => (i.context.issues[0].observed_at = "2026-10-29T00:00:00Z"),
    "snapshot_stale",
  ],
  ["no label", (i) => (i.context.issues[0].labels = []), "status_mapping"],
  [
    "two labels",
    (i) => i.context.issues[0].labels.push("project:assigned"),
    "status_mapping",
  ],
  [
    "mapping duplicate",
    (i) => {
      i.project.status_mapping.draft = i.project.status_mapping.assigned;
      bind(i);
    },
    "status_mapping",
  ],
  [
    "inventory",
    (i) => (i.context.issues[0].inventory_status = "unknown"),
    "inventory_unknown",
  ],
  [
    "unknown state",
    (i) => (i.context.issues[0].github_state = "unknown"),
    "source_unknown",
  ],
  [
    "closed progressing",
    (i) => (i.context.issues[0].github_state = "closed"),
    "status_conflict",
  ],
  [
    "confirmation missing",
    (i) => (i.context.feature_confirmations = []),
    "feature_confirmation",
  ],
  [
    "confirmation duplicate",
    (i) =>
      i.context.feature_confirmations.push(
        clone(i.context.feature_confirmations[0]),
      ),
    "feature_confirmation",
  ],
  [
    "pending operation",
    (i) => (i.context.issues[0].pending_operations = ["op-a"]),
    "pending_operation",
  ],
  [
    "precondition denied",
    (i) => (i.context.issues[0].preconditions = fact("denied")),
    "precondition",
  ],
  [
    "precondition unknown",
    (i) => (i.context.issues[0].preconditions = fact("unknown")),
    "precondition",
  ],
  [
    "unknown field",
    (i) => (i.context.secret = "CANARY_PRIVATE"),
    "schema_invalid",
  ],
])
  test(name, () => {
    const i = input();
    mutate(i);
    const r = blocked(i, code);
    assert.notEqual(r.features[0]?.status, "completed");
    assert.ok(!JSON.stringify(r).includes("CANARY_PRIVATE"));
  });
test("login/repo casing and snapshot deadline inclusive", () => {
  const i = active(input());
  i.context.repository = "EXAMPLE/PROJECT";
  i.context.issues[0].assignees = ["EXAMPLE-USER"];
  i.context.evaluated_at = "2026-10-30T01:00:00Z";
  assert.equal(aggregateProject(i).status, "pass");
});
for (const [name, mutate, code] of [
  [
    "owner",
    (i) => (i.context.issues[0].assignees = ["other"]),
    "owner_mismatch",
  ],
  [
    "two claims",
    (i) =>
      i.context.issues[0].claims.push({
        ...clone(i.context.issues[0].claims[0]),
        claim_id: "claim-b",
      }),
    "claim_conflict",
  ],
  [
    "duplicate claim",
    (i) =>
      i.context.issues[0].claims.push(clone(i.context.issues[0].claims[0])),
    "claim_conflict",
  ],
  [
    "missing branch",
    (i) => (i.context.issues[0].branches = []),
    "branch_missing",
  ],
  [
    "branch absent",
    (i) => (i.context.issues[0].branches[0].existence = "absent"),
    "branch_missing",
  ],
  [
    "unpush unknown",
    (i) => (i.context.issues[0].unpushed.state = "unknown"),
    "unpushed_unknown",
  ],
  [
    "future heartbeat",
    (i) =>
      (i.context.issues[0].claims[0].last_heartbeat_at =
        "2026-11-01T00:00:00Z"),
    "claim_time",
  ],
  [
    "claim different owner",
    (i) => (i.context.issues[0].claims[0].human_owner = "other"),
    "owner_mismatch",
  ],
])
  test("active " + name, () => {
    const i = active(input());
    mutate(i);
    blocked(i, code);
  });
test("stale warns without releasing active work, exact boundary is not stale", () => {
  const i = active(input());
  i.project.claim_policy.stale_after_seconds = 100;
  i.project.claim_policy.heartbeat_interval_seconds = 50;
  bind(i);
  i.context.evaluated_at = "2026-10-30T00:01:40Z";
  assert.equal(aggregateProject(i).issues[0].active_claim_count, 1);
  assert.ok(
    !aggregateProject(i).diagnostics.some((d) => d.code === "claim_stale"),
  );
  i.context.evaluated_at = "2026-10-30T00:01:41Z";
  const r = aggregateProject(i);
  has(r, "claim_stale");
  assert.equal(r.issues[0].active_claim_count, 1);
});
test("design review without a fake claim and actual blocked status", () => {
  const i = input();
  status(i, "in_review");
  i.context.issues[0].review = { kind: "design", reference: clone(ref) };
  assert.equal(aggregateProject(i).status, "pass");
  status(i, "blocked");
  i.context.issues[0].blockers = [clone(ref)];
  const r = aggregateProject(i);
  assert.equal(r.status, "pass");
  assert.equal(r.features[0].status, "blocked");
});
test("release must include evidence of stopping and handoff; labels never release", () => {
  const i = active(completed());
  status(i, "completed");
  blocked(i, "terminal_claim");
  i.context.issues[0].claims[0].phase = "released";
  blocked(i, "release_unconfirmed");
  i.context.issues[0].claims[0].release = {
    approval: { ...clone(approval), approval_type: "claim_release" },
    released_at: "2026-10-30T00:00:00Z",
    stopped: clone(ref),
    handoff: clone(ref),
    unpushed: clone(ref),
  };
  assert.equal(aggregateProject(i).issues[0].active_claim_count, 0);
});
test("optional unfinished issue stays listed without blocking required completion", () => {
  const i = completed();
  i.deliveryPlan.features[0].issue_refs.push({
    issue_ref: row(2).issue_ref,
    work_id: "issue-2",
    required: false,
  });
  i.context.issues.push(row(2));
  bind(i);
  assert.equal(aggregateProject(i).features[0].status, "completed");
  assert.equal(aggregateProject(i).counts.issue_count, 2);
  i.context.issues[1].pending_operations = ["op-x"];
  assert.equal(aggregateProject(i).features[0].status, "blocked");
});
test("dependency unknown/blocked/cancelled cannot become ready; cycles rejected", () => {
  const i = input(),
    b = feature("b", ["a"]);
  i.deliveryPlan.features.push(b);
  i.context.feature_confirmations.push({
    feature_id: "b",
    acceptance: fact("unknown"),
    cancellation: null,
  });
  bind(i);
  assert.equal(
    aggregateProject(i).features.find((f) => f.feature_id === "b").status,
    "planned",
  );
  i.context.collection_status = "unknown";
  assert.notEqual(
    aggregateProject(i).features.find((f) => f.feature_id === "b").status,
    "ready",
  );
  i.deliveryPlan.features[0].depends_on = [
    { feature_id: "b", reason: "cycle" },
  ];
  bind(i);
  blocked(i, "dependency_cycle");
});
test("managed schema/state replay is reused and normal resume stop is not corruption", () => {
  const i = managed();
  assert.equal(aggregateProject(i).status, "pass");
  active(i);
  event(i.workflows[0].input, "stage_started", "intake");
  i.workflows[0].input.state.next_stage = null;
  const r = aggregateProject(i);
  assert.equal(r.status, "pass");
  assert.equal(r.issues[0].workflow.resume_decision, "blocked");
  assert.equal(r.issues[0].workflow.current_stage, "intake");
  i.workflows[0].input.state.status = "completed";
  blocked(i, "workflow_invalid");
});
for (const [name, change, code] of [
  ["missing", (i) => (i.workflows = []), "workflow_missing"],
  [
    "duplicate",
    (i) => i.workflows.push(clone(i.workflows[0])),
    "workflow_duplicate",
  ],
  [
    "identity",
    (i) => (i.workflows[0].input.state.feature_id = "wrong"),
    "workflow_identity",
  ],
  [
    "git",
    (i) => {
      active(i);
      i.context.issues[0].branches[0].head_commit = "f".repeat(40);
    },
    "workflow_source",
  ],
  [
    "rule",
    (i) => (i.workflows[0].input.plan.resolved_rules = []),
    "workflow_invalid",
  ],
])
  test("managed " + name, () => {
    const i = managed();
    change(i);
    blocked(i, code);
  });
test("checkpoint replay preserves counts, detects changed prefix and missing rows", () => {
  const i = managed(),
    a = aggregateProject(i);
  i.checkpoint = clone(a.checkpoint);
  const b = aggregateProject(i);
  assert.deepEqual(b.counts, a.counts);
  assert.equal(b.issues[0].new_event_count, 0);
  i.workflows[0].input.state.history[0].evidence = [
    { kind: "file", target: "README.md" },
  ];
  blocked(i, "history_rewritten");
});
test("checkpoint cannot authorize stale/new-revision data or skip replay", () => {
  const i = managed();
  i.checkpoint = aggregateProject(i).checkpoint;
  i.checkpoint.plan_digest = "f".repeat(64);
  blocked(i, "checkpoint_mismatch");
  delete i.checkpoint;
  i.checkpoint = aggregateProject(i).checkpoint;
  i.workflows[0].input.state.next_stage = "handoff";
  blocked(i, "workflow_invalid");
});
test("checkpoint new valid events counted once; broken issue checkpoint retained", () => {
  const i = managed();
  i.checkpoint = aggregateProject(i).checkpoint;
  active(i);
  event(i.workflows[0].input, "stage_started", "intake");
  i.workflows[0].input.state.next_stage = null;
  const r = aggregateProject(i);
  assert.equal(r.issues[0].new_event_count, 1);
  i.checkpoint = r.checkpoint;
  assert.equal(aggregateProject(i).issues[0].new_event_count, 0);
  i.context.issues = [];
  const b = blocked(i, "issue_missing");
  assert.deepEqual(b.checkpoint.issues, i.checkpoint.issues);
});
test("representative max 100 issues remains deterministic within 5 seconds", () => {
  const i = large(),
    t = performance.now(),
    r = aggregateProject(i);
  assert.equal(r.status, "pass");
  assert.equal(r.counts.issue_count, 100);
  assert.equal(r.counts.feature_count, 100);
  assert.ok(performance.now() - t < 5000);
});

test("explicit feature cancellation precedes cancelled required issue without active work", () => {
  const i = input();
  status(i, "cancelled");
  i.context.issues[0].cancellation = clone(approval);
  i.context.feature_confirmations[0].cancellation = clone(approval);
  assert.equal(aggregateProject(i).features[0].status, "cancelled");
});
test("completed feature with unmet dependency must not hide the conflict", () => {
  const i = completed();
  const b = feature("b");
  i.deliveryPlan.features.push(b);
  i.deliveryPlan.features[0].depends_on = [
    { feature_id: "b", reason: "unfinished" },
  ];
  i.context.feature_confirmations.push({
    feature_id: "b",
    acceptance: fact("unknown"),
    cancellation: null,
  });
  bind(i);
  assert.equal(
    aggregateProject(i).features.find((f) => f.feature_id === "a").status,
    "blocked",
  );
});
test("unknown required acceptance blocks report rather than returning a full pass", () => {
  const i = completed();
  i.context.feature_confirmations[0].acceptance = fact("unknown");
  assert.equal(aggregateProject(i).status, "blocked");
});
for (const state of ["pending", "unknown", "satisfied"])
  test("constraint " + state, () => {
    const i = input();
    i.deliveryPlan.features[0].constraints = [
      { kind: "approval", reason: "review", reference: clone(ref) },
    ];
    i.context.constraint_facts = [
      {
        feature_id: "a",
        constraint_index: 0,
        state,
        ...(state === "satisfied" ? { evidence: clone(ref) } : {}),
      },
    ];
    bind(i);
    const r = aggregateProject(i);
    assert.equal(
      r.features[0].status,
      state === "satisfied"
        ? "ready"
        : state === "pending"
          ? "blocked"
          : "unknown",
    );
  });
test("future cancellation cannot turn an existing known conflict into merely unknown", () => {
  const i = active(input());
  i.context.issues[0].assignees = ["other"];
  i.context.feature_confirmations[0].cancellation = {
    ...clone(approval),
    approved_at: "2027-01-01T00:00:00Z",
  };
  assert.equal(aggregateProject(i).features[0].status, "blocked");
});
test("orphan branch and PR closed alone are not completion", () => {
  const i = input();
  i.context.issues[0].branches = [
    {
      name: "orphan",
      head_commit: "0".repeat(40),
      existence: "confirmed",
      evidence: clone(ref),
    },
  ];
  blocked(i, "orphan_branch");
  const c = completed();
  c.context.issues[0].completion = fact("unknown");
  c.context.issues[0].prs = [
    {
      number: 2,
      head_branch: "old",
      head_commit: "0".repeat(40),
      base_branch: "main",
      state: "closed",
      evidence: clone(ref),
    },
  ];
  blocked(c, "precondition");
});
test("managed completed label cannot conceal an incomplete workflow", () => {
  const i = managed(completed());
  status(i, "completed");
  i.context.issues[0].completion = fact();
  blocked(i, "status_conflict");
});
for (const mutation of [
  (i) => i.workflows[0].input.state.history.pop(),
  (i) =>
    i.workflows[0].input.state.history.push(
      clone(i.workflows[0].input.state.history[0]),
    ),
  (i) =>
    (i.workflows[0].input.previous = {
      plan: clone(i.workflows[0].input.plan),
      state: {
        ...clone(i.workflows[0].input.state),
        history: [
          {
            ...clone(i.workflows[0].input.state.history[0]),
            reason: "rewritten",
          },
        ],
      },
    }),
])
  test("historical replay refuses shortening, duplicate or rewritten original", () => {
    const i = managed();
    i.checkpoint = aggregateProject(i).checkpoint;
    mutation(i);
    assert.equal(aggregateProject(i).status, "blocked");
  });
test("missing managed input leaves its prior event checkpoint untouched", () => {
  const i = managed();
  i.checkpoint = aggregateProject(i).checkpoint;
  i.workflows = [];
  const r = blocked(i, "workflow_missing");
  assert.deepEqual(r.checkpoint.issues, i.checkpoint.issues);
});
test("workflow identifiers are scoped by issue: same event id in different issue is fine", () => {
  const i = managed(),
    w = clone(i.workflows[0]);
  i.deliveryPlan.features[0].issue_refs.push({
    issue_ref: row(2).issue_ref,
    work_id: "issue-2",
    required: false,
  });
  const r = clone(i.context.issues[0]);
  r.issue_ref = row(2).issue_ref;
  r.work_id = "issue-2";
  i.context.issues.push(r);
  w.issue_ref = r.issue_ref;
  for (const x of [w.input.plan, w.input.state, w.input.context]) {
    x.issue_ref = r.issue_ref;
    x.work_id = r.work_id;
  }
  i.workflows.push(w);
  bind(i);
  const result = aggregateProject(i);
  assert.equal(result.status, "pass");
  assert.equal(result.checkpoint.issues.length, 2);
});
test("case-insensitive GitHub identity also applies to checkpoint/source joins", () => {
  const i = managed();
  i.checkpoint = aggregateProject(i).checkpoint;
  i.context.repository = "EXAMPLE/PROJECT";
  i.context.issues[0].issue_ref = i.context.issues[0].issue_ref.replace(
    "example/project",
    "EXAMPLE/PROJECT",
  );
  assert.equal(aggregateProject(i).status, "pass");
});

test("100 managed issues are replayed within the input and time budget", () => {
  const i = largeManaged(),
    t = performance.now(),
    r = aggregateProject(i);
  assert.equal(r.status, "pass");
  assert.equal(r.issues.length, 100);
  assert.equal(r.checkpoint.issues.length, 100);
  assert.ok(performance.now() - t < 5000);
});
test("claim IDs cannot be reused across two issues", () => {
  const i = active(input()),
    r = clone(i.context.issues[0]);
  r.issue_ref = row(2).issue_ref;
  r.work_id = "issue-2";
  i.context.issues.push(r);
  i.deliveryPlan.features[0].issue_refs.push({
    issue_ref: r.issue_ref,
    work_id: r.work_id,
    required: false,
  });
  bind(i);
  blocked(i, "claim_conflict");
});
test("managed running work cannot be advertised as available", () => {
  const i = managed();
  event(i.workflows[0].input, "stage_started", "intake");
  i.workflows[0].input.state.next_stage = null;
  status(i, "available_for_work");
  i.context.issues[0].human_owner = null;
  i.context.issues[0].assignees = [];
  blocked(i, "status_conflict");
});
test("future workflow snapshot is not a current observation", () => {
  const i = managed();
  i.workflows[0].input.state.updated_at = "2027-01-01T00:00:00Z";
  blocked(i, "workflow_source");
});
test("internal pending operations cannot be hidden by an empty GitHub projection", () => {
  const i = managed();
  i.workflows[0].input.state.resume.pending_operations = ["unfinished"];
  blocked(i, "pending_operation");
});
test("managed completion is derived by the original checker with validation evidence", async () => {
  const {
    paused,
    finish,
    event: emit,
    ref: reference,
    stamp: at,
  } = await import("../workflow-check/fixtures/build.mjs");
  const i = managed(completed()),
    w = paused();
  emit(w, "work_resumed");
  finish(w, "validation");
  finish(w, "handoff");
  w.state.validations.push({
    validation_id: "final",
    status: "passed",
    reference,
    executed_at: at,
  });
  w.state.extensions.workflow_check.validation_scopes.push({
    validation_id: "final",
    plan_revision: 1,
    stage: "validation",
  });
  emit(w, "work_completed");
  w.state.next_stage = null;
  for (const set of [
    w.plan,
    w.state,
    w.context,
    w.previous.plan,
    w.previous.state,
  ])
    Object.assign(set, { project_id: i.project.project_id, feature_id: "a" });
  i.workflows[0].input = w;
  status(i, "completed");
  const r = aggregateProject(i);
  assert.equal(r.status, "pass", JSON.stringify(r.diagnostics));
  assert.equal(r.features[0].status, "completed");
});
