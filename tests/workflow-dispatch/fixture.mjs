// Synthetic records. They do not authenticate a human or authorize live writes.
import { readFileSync } from "node:fs";
import {
  fixture as execution,
  ref,
  hash,
  time,
  source,
} from "../workflow-execution/fixture.mjs";
import { snapshot, policy } from "../workflow-github/fixture.mjs";
export { hash, time };
export function fixture() {
  const read = (n) =>
    JSON.parse(
      readFileSync(
        new URL(
          "../workflow-recommend/fixtures/" + n + ".json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  const project = read("project"),
    team = read("team"),
    deliveryPlan = read("deliveryPlan");
  for (const x of [project, team, deliveryPlan]) x.schema_version = 2;
  project.coordination_mode = "dispatcher";
  project.repository_id = 1;
  project.areas.push({
    area_id: "frontend",
    paths: ["packages/frontend"],
    shared: false,
    integration_owner: null,
    conflict_policy: "disjoint_scopes",
  });
  team.members[0].areas.push("frontend");
  team.members[0].max_concurrent_issues = 3;
  const a = deliveryPlan.features[0];
  deliveryPlan.features.push({
    ...structuredClone(a),
    feature_id: "b",
    source_ref: { ...a.source_ref, fragment: "feature-b" },
    area_ids: ["frontend"],
    planned_priority: 2,
    issue_refs: [
      {
        issue_ref: "https://github.com/example/project/issues/2",
        work_id: "issue-2",
        required: true,
      },
    ],
  });
  project.dispatcher = {
    storage_id: "synthetic-ledger",
    max_parallel_issues: 2,
    max_run_issues: 10,
    team: { revision: team.revision, digest: hash(team) },
    delivery_plan: {
      revision: deliveryPlan.revision,
      digest: hash(deliveryPlan),
    },
  };
  const e = execution(),
    { profile, grant } = e;
  profile.repository = project.repository;
  profile.human_owner = "example-user";
  profile.allowed_paths = ["packages", "docs"];
  grant.repository = project.repository;
  grant.human_owner = "example-user";
  grant.request.actor = { ...grant.request.actor, actor_ref: "example-user" };
  grant.profile = ref(profile);
  grant.selected = [1, 2].map((n) => ({
    ...structuredClone(grant.selected[0]),
    issue_number: n,
    work_id: "issue-" + n,
    profile: ref(profile),
    allowed_paths: [n === 1 ? "packages/backend" : "packages/frontend"],
    shared_areas: [],
    contract_digest: String(n).repeat(64),
  }));
  const p = policy(profile);
  p.repository = project.repository;
  p.owner = { id: 7, login: "example-user" };
  const observed = snapshot(p);
  observed.repository = project.repository;
  observed.issues = grant.selected.map((t) => ({
    ...structuredClone(observed.issues[0]),
    number: t.issue_number,
    id: 10 + t.issue_number,
    assignees: [{ id: 7, login: "example-user" }],
    contract_digest: t.contract_digest,
  }));
  observed.permissions = [
    {
      actor_id: 7,
      login: "example-user",
      permission: "admin",
      observed_at: time,
    },
  ];
  const f = {
    project,
    team,
    deliveryPlan,
    profile,
    grant,
    snapshot: observed,
    evaluated_at: time,
    requested_issues: null,
    issue_facts: [1, 2].map((n) => ({
      issue_number: n,
      priority: n,
      approval: "approved",
      blocker: "none",
      pr_numbers: [],
    })),
    constraint_facts: [],
    ledger: {
      schema_version: 1,
      artifact_kind: "ledger-view",
      project_id: project.project_id,
      configuration_digest: "0".repeat(64),
      generation: 1,
      status: "ready",
      complete: true,
      claims: [],
      pending_operations: [],
      runs: [],
      history: { claims: 0, operations: 0, events: 0 },
    },
  };
  return bind(f);
}
export function bind(f) {
  f.project.dispatcher.team = {
    revision: f.team.revision,
    digest: hash(f.team),
  };
  f.project.dispatcher.delivery_plan = {
    revision: f.deliveryPlan.revision,
    digest: hash(f.deliveryPlan),
  };
  f.ledger.configuration_digest = hash({
    project: f.project,
    team: f.team,
    deliveryPlan: f.deliveryPlan,
  });
  return f;
}
export function claim(overrides = {}) {
  return {
    claim_id: "claim-existing",
    operation_id: "op-existing",
    input_digest: "a".repeat(64),
    run_id: "run-existing",
    worker_id: "worker-existing",
    generation: 1,
    issue_number: 9,
    human_owner: "example-user",
    areas: ["backend"],
    allowed_paths: ["packages/backend"],
    forbidden_paths: ["secrets"],
    status: "in_review",
    reserved_at: time,
    updated_at: time,
    head_sha: "2".repeat(40),
    execution_active: false,
    profile_digest: "b".repeat(64),
    grant_digest: "c".repeat(64),
    origin: "dispatcher",
    feature_id: "a",
    contract_digest: "c".repeat(64),
    design_digest: "d".repeat(64),
    stages: ["validation"],
    branch: null,
    policy_digest: null,
    ...overrides,
  };
}
export function migrationInput(f = fixture()) {
  const to = { project: f.project, team: f.team, deliveryPlan: f.deliveryPlan },
    from = structuredClone(to);
  for (const v of Object.values(from)) v.schema_version = 1;
  from.project.coordination_mode = "manual";
  delete from.project.dispatcher;
  delete from.project.repository_id;
  const legacy_claims = [];
  const migration = {
    schema_version: 1,
    artifact_kind: "migration",
    project_id: f.project.project_id,
    configuration_digest: f.ledger.configuration_digest,
    source_digest: hash(from),
    inventory_digest: hash({ snapshot: f.snapshot, legacy_claims }),
    observed_at: time,
    dispositions: f.snapshot.sources.map((s) => ({
      kind: "manual",
      id: s.kind + ":" + s.id,
      disposition: "not_claim",
      claim: null,
      approval_refs: [source("manual-confirmation")],
    })),
  };
  return {
    from,
    to,
    snapshot: f.snapshot,
    legacy_claims,
    migration,
    evaluated_at: time,
  };
}
