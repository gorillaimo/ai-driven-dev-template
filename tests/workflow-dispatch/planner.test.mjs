import test from "node:test";
import assert from "node:assert/strict";
import { fixture, bind, claim } from "./fixture.mjs";
import { validateProjectV2 } from "../../tools/workflow-dispatch/check.mjs";
import { planBatch } from "../../tools/workflow-dispatch/plan.mjs";
test("independent assigned issues are selected deterministically without running v1 recommendation", () => {
  const r = planBatch(fixture());
  assert.equal(r.status, "passed", JSON.stringify(r));
  assert.deepEqual(
    r.selected.map((x) => x.issue_number),
    [1, 2],
  );
  assert.equal(r.authority, false);
});
test("v2 configuration binds team and delivery revisions/digests", () => {
  const f = fixture();
  f.team.members[0].max_concurrent_issues++;
  assert.equal(validateProjectV2(f).status, "blocked");
  assert.equal(validateProjectV2(bind(f)).status, "passed");
});
for (const [name, change] of [
  ["v1 header", (f) => (f.project.schema_version = 1)],
  ["manual mode", (f) => (f.project.coordination_mode = "manual")],
  ["unknown field", (f) => (f.project.extra = true)],
  ["unsupported backend", (f) => (f.project.runtime_backend = "projects")],
  ["unknown area", (f) => (f.deliveryPlan.features[0].area_ids = ["missing"])],
  [
    "cycle",
    (f) => {
      f.deliveryPlan.features[0].depends_on = [
        { feature_id: "b", reason: "synthetic" },
      ];
      f.deliveryPlan.features[1].depends_on = [
        { feature_id: "a", reason: "synthetic" },
      ];
    },
  ],
  [
    "unknown dependency",
    (f) =>
      (f.deliveryPlan.features[0].depends_on = [
        { feature_id: "missing", reason: "synthetic" },
      ]),
  ],
])
  test("invalid configuration stops " + name, () => {
    const f = fixture();
    change(f);
    assert.equal(planBatch(bind(f)).status, "blocked");
  });
for (const field of ["approval", "blocker"])
  test("one known local blocker allows an independent issue: " + field, () => {
    const f = fixture();
    f.issue_facts[0][field] = field === "approval" ? "pending" : "known";
    const r = planBatch(f);
    assert.deepEqual(
      r.selected.map((x) => x.issue_number),
      [2],
    );
    assert.equal(r.held[0].issue_number, 1);
  });
test("specific requested issue narrows selection and never bypasses its blocker", () => {
  const f = fixture();
  f.requested_issues = [1];
  f.issue_facts[0].approval = "pending";
  assert.deepEqual(planBatch(f).selected, []);
});
test("an unmerged dependency is held even if its PR is ready", () => {
  const f = fixture();
  f.deliveryPlan.features[1].depends_on = [
    { feature_id: "a", reason: "synthetic" },
  ];
  const r = planBatch(bind(f));
  assert.deepEqual(
    r.selected.map((x) => x.issue_number),
    [1],
  );
});
for (const [name, change] of [
  ["partial inventory", (f) => (f.snapshot.status = "partial")],
  ["unknown permissions", (f) => (f.snapshot.sections.permissions = "unknown")],
  ["stale inventory", (f) => (f.evaluated_at = "2026-11-04T01:00:00Z")],
  ["unknown blocker scope", (f) => (f.issue_facts[0].blocker = "unknown")],
  ["duplicate claim", (f) => (f.ledger.claims = [claim(), claim()])],
  ["recovery barrier", (f) => (f.ledger.status = "recovery_required")],
  ["unknown ledger inventory", (f) => (f.ledger.complete = false)],
  [
    "wrong contract",
    (f) => (f.snapshot.issues[0].contract_digest = "0".repeat(64)),
  ],
])
  test("global uncertainty prevents all new starts: " + name, () => {
    const f = fixture();
    change(f);
    const r = planBatch(f);
    assert.equal(r.status, "blocked");
    assert.deepEqual(r.selected, []);
  });
test("in_review retains claim/path reservation while freeing an execution slot", () => {
  const f = fixture();
  f.ledger.claims = [claim({ issue_number: 1 })];
  const r = planBatch(f);
  assert.deepEqual(
    r.selected.map((x) => x.issue_number),
    [2],
  );
});
test("owner claim limit counts blocked and review claims independently of execution slots", () => {
  const f = fixture();
  f.team.members[0].max_concurrent_issues = 1;
  f.ledger.claims = [claim({ status: "blocked" })];
  assert.deepEqual(planBatch(bind(f)).selected, []);
});
test("path prefixes conflict even when area names differ", () => {
  const f = fixture();
  f.ledger.claims = [
    claim({ areas: ["contracts"], allowed_paths: ["packages"] }),
  ];
  assert.deepEqual(planBatch(f).selected, []);
});
test("untrusted getters are never evaluated or published", () => {
  const f = fixture();
  let called = false;
  Object.defineProperty(f, "surprise", {
    enumerable: true,
    get() {
      called = true;
      throw Error("PRIVATE_CANARY");
    },
  });
  const r = planBatch(f);
  assert.equal(r.status, "blocked");
  assert.equal(called, false);
  assert.ok(!JSON.stringify(r).includes("PRIVATE_CANARY"));
});
test("a requested subset cannot conceal a changed contract elsewhere in the grant", () => {
  const f = fixture();
  f.requested_issues = [1];
  f.snapshot.issues[1].contract_digest = "0".repeat(64);
  assert.equal(planBatch(f).status, "blocked");
});
test("external/approval constraints need current matching facts", () => {
  const f = fixture();
  f.deliveryPlan.features[0].constraints = [
    {
      kind: "external_dependency",
      reference: { kind: "url", target: "https://example.invalid/dependency" },
      reason: "Synthetic",
    },
  ];
  assert.deepEqual(
    planBatch(bind(f)).selected.map((t) => t.issue_number),
    [2],
  );
});
test("historical completed allocations still consume the per-run issue budget", () => {
  const f = fixture();
  f.ledger.runs = [
    {
      run_id: f.grant.run_id,
      issues_count: 10,
      issue_limit: 10,
      profile_digest: f.grant.profile.digest,
      stopped: false,
      expires_at: f.grant.expires_at,
    },
  ];
  assert.deepEqual(planBatch(f).selected, []);
});
test("a shared area also reserves paths omitted from feature area labels", () => {
  const f = fixture();
  f.project.areas.push({
    area_id: "shared",
    paths: ["packages"],
    shared: true,
    integration_owner: "example-user",
    conflict_policy: "serialize",
  });
  f.team.members[0].areas.push("shared");
  f.team.members[0].integration_owner.push("shared");
  assert.deepEqual(
    planBatch(bind(f)).selected.map((t) => t.issue_number),
    [1],
  );
});

test("git metadata area is rejected before planning", () => {
  const f = fixture();
  f.project.areas[0].paths = ["packages/.git"];
  bind(f);
  assert.equal(planBatch(f).status, "blocked");
});
test("unknown approval or constraint state stops the complete batch", () => {
  for (const what of ["approval", "constraint"]) {
    const f = fixture();
    if (what === "approval") f.issue_facts[0].approval = "unknown";
    else
      f.constraint_facts.push({
        feature_id: "a",
        constraint_digest: "a".repeat(64),
        status: "unknown",
      });
    assert.equal(planBatch(f).status, "blocked", what);
  }
});
test("repository permission honors the Project required level", () => {
  const f = fixture();
  f.project.required_repository_permission = "admin";
  f.snapshot.permissions[0].permission = "write";
  bind(f);
  assert.equal(planBatch(f).status, "blocked");
});
function pullRequest(f, patch = {}) {
  return {
    id: 100,
    number: 10,
    state: "open",
    draft: false,
    head_branch: "work/1",
    head_sha: "1".repeat(40),
    base_branch: "main",
    base_sha: "2".repeat(40),
    head_repository_id: f.snapshot.repository_id,
    merged: false,
    updated_at: f.evaluated_at,
    body_digest: "a".repeat(64),
    actor_id: 7,
    ...patch,
  };
}
test("a closed dependency requires an actually merged PR, then releases its downstream candidate", () => {
  const f = fixture();
  f.deliveryPlan.features[1].depends_on = [
    { feature_id: "a", reason: "API first" },
  ];
  f.snapshot.issues[0].state = "closed";
  f.issue_facts[0].pr_numbers = [10];
  f.snapshot.prs = [pullRequest(f)];
  bind(f);
  assert.deepEqual(planBatch(f).selected, []);
  f.snapshot.prs[0].state = "closed";
  assert.deepEqual(planBatch(f).selected, []);
  f.snapshot.prs[0].merged = true;
  assert.deepEqual(
    planBatch(f).selected.map((t) => t.issue_number),
    [2],
  );
});
test("latest priority is deterministic and empty scope selects no Issue", () => {
  const f = fixture();
  f.issue_facts[1].priority = 1;
  f.issue_facts[0].priority = 2;
  assert.deepEqual(
    planBatch(f).selected.map((t) => t.issue_number),
    [2, 1],
  );
  f.requested_issues = [];
  assert.deepEqual(planBatch(f).selected, []);
});
test("ambiguous snapshot permissions stop all selection", () => {
  const f = fixture();
  f.snapshot.permissions.push({
    ...f.snapshot.permissions[0],
    permission: "read",
  });
  assert.equal(planBatch(f).status, "blocked");
});
test("a constraint with an unknown area stops configuration validation", () => {
  const f = fixture();
  f.deliveryPlan.features[0].constraints.push({
    kind: "shared_area",
    reference: { kind: "id", target: "missing" },
    reason: "Synthetic",
    area_id: "missing",
  });
  assert.equal(validateProjectV2(bind(f)).status, "blocked");
});
