import {
  input as planInput,
  feature,
  clone,
  ref,
  actor,
} from "../workflow-project/helpers.mjs";
import { fixture, event } from "../workflow-check/fixtures/build.mjs";
import { canonical, digest } from "../../tools/workflow-rules/resolve.mjs";
export { clone, ref, actor, feature, event };
export const stamp = "2026-10-30T00:00:00Z";
export const fact = (state = "confirmed") => ({
  state,
  evidence: state === "unknown" ? null : clone(ref),
});
export const approval = {
  approval_type: "cancel",
  approved_by: "example-user",
  reference: ref,
  approved_at: stamp,
};
export function bind(i) {
  Object.assign(i.context, {
    project_id: i.project.project_id,
    repository: i.project.repository,
    project_revision: i.project.revision,
    plan_revision: i.deliveryPlan.revision,
    project_digest: digest(canonical(i.project)),
    plan_digest: digest(canonical(i.deliveryPlan)),
  });
  return i;
}
export function row(n = 1, id = "a") {
  return {
    issue_ref: `https://github.com/example/project/issues/${n}`,
    work_id: "issue-" + n,
    feature_id: id,
    observed_at: stamp,
    issue_updated_at: "2026-10-23T00:00:00Z",
    source: clone(ref),
    github_state: "open",
    labels: ["project:available-for-work"],
    assignees: [],
    human_owner: null,
    ready_for_ai: true,
    inventory_status: "complete",
    preconditions: fact(),
    completion: fact("unknown"),
    cancellation: null,
    review: { kind: "none", reference: null },
    blockers: [],
    pending_operations: [],
    unpushed: { state: "clear", evidence: clone(ref) },
    claims: [],
    branches: [],
    prs: [],
    workflow_mode: "legacy",
  };
}
export function input() {
  const i = planInput([feature("a")]);
  i.deliveryPlan.features[0].issue_refs = [
    { issue_ref: row().issue_ref, work_id: "issue-1", required: true },
  ];
  i.context = {
    schema_version: 1,
    observed_at: stamp,
    evaluated_at: stamp,
    freshness_limit_seconds: 3600,
    recorded_by: clone(actor),
    source: clone(ref),
    collection_status: "complete",
    issues: [row()],
    feature_confirmations: [
      { feature_id: "a", acceptance: fact("unknown"), cancellation: null },
    ],
    constraint_facts: [],
  };
  i.workflows = [];
  return bind(i);
}
export function status(i, s) {
  i.context.issues[0].labels = [i.project.status_mapping[s]];
  return i;
}
export function active(i) {
  const r = i.context.issues[0];
  status(i, "in_progress");
  r.human_owner = "example-user";
  r.assignees = ["example-user"];
  r.claims = [
    {
      claim_id: "claim-a",
      human_owner: "example-user",
      branch: "feature/1-example",
      phase: "active",
      claimed_at: stamp,
      last_heartbeat_at: stamp,
      evidence: clone(ref),
      release: null,
    },
  ];
  r.branches = [
    {
      name: "feature/1-example",
      head_commit: "0".repeat(40),
      existence: "confirmed",
      evidence: clone(ref),
    },
  ];
  return i;
}
export function managed(i = input()) {
  const w = fixture();
  for (const x of [w.plan, w.state, w.context])
    Object.assign(x, { project_id: i.project.project_id, feature_id: "a" });
  i.context.issues[0].workflow_mode = "managed";
  i.context.issues[0].human_owner = "example-user";
  i.context.issues[0].assignees = ["example-user"];
  status(i, "assigned");
  i.workflows = [{ issue_ref: i.context.issues[0].issue_ref, input: w }];
  return i;
}
export function completed(i = input()) {
  status(i, "completed");
  i.context.issues[0].github_state = "closed";
  i.context.issues[0].completion = fact();
  i.context.feature_confirmations[0].acceptance = fact();
  return i;
}
export function large() {
  const i = input();
  i.deliveryPlan.features = [];
  i.context.issues = [];
  i.context.feature_confirmations = [];
  for (let n = 1; n <= 100; n++) {
    const id = "f" + n,
      f = feature(id);
    f.issue_refs = [
      {
        issue_ref: row(n, id).issue_ref,
        work_id: "issue-" + n,
        required: true,
      },
    ];
    i.deliveryPlan.features.push(f);
    i.context.issues.push(row(n, id));
    i.context.feature_confirmations.push({
      feature_id: id,
      acceptance: fact("unknown"),
      cancellation: null,
    });
  }
  return bind(i);
}

export function largeManaged() {
  const i = large(),
    base = managed().workflows[0];
  for (const r of i.context.issues) {
    r.workflow_mode = "managed";
    r.labels = ["project:assigned"];
    r.human_owner = "example-user";
    r.assignees = ["example-user"];
    const b = clone(base);
    b.issue_ref = r.issue_ref;
    for (const x of [b.input.plan, b.input.state, b.input.context])
      Object.assign(x, {
        issue_ref: r.issue_ref,
        work_id: r.work_id,
        feature_id: r.feature_id,
      });
    i.workflows.push(b);
  }
  return i;
}
