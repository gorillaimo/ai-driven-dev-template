import test from "node:test";
import assert from "node:assert/strict";
import {
  fixture as execution,
  rebind,
  source,
} from "../workflow-execution/fixture.mjs";
import { profile } from "./fixture.mjs";
import { hash } from "../../tools/workflow-runner/core.mjs";
import { checkRunnerEvidence } from "../../tools/workflow-runner/evidence.mjs";
function fixture() {
  const input = execution(),
    p = profile({ execution_profile_digest: hash(input.profile) }),
    claim = {
      claim_id: "claim-1",
      worker_id: "worker-1",
      generation: 1,
      run_id: "run-1",
      issue_number: 1,
      head_sha: "2".repeat(40),
    };
  const attempts = ["implementation", "verification", "review"].map(
    (role, i) => ({
      schema_version: 1,
      artifact_kind: "runner-attempt",
      attempt_id: "attempt-" + i,
      run_id: "run-1",
      claim_id: "claim-1",
      worker_id: "worker-1",
      generation: 1,
      issue_number: 1,
      role,
      context_id:
        role === "implementation"
          ? "impl-1"
          : role === "review"
            ? "review-1"
            : "verification-1",
      profile_digest: hash(p),
      head_sha: claim.head_sha,
      status: "completed",
      container_id: "synthetic-" + i,
      started_at: input.context.evaluated_at,
      updated_at: input.context.evaluated_at,
      stopped: true,
      artifact_digest: String(i + 1).repeat(64),
    }),
  );
  input.verifications[0].log_refs = [
    { ...source("verification-log"), digest: attempts[1].artifact_digest },
  ];
  input.reviews[0].evidence_refs = [
    { ...source("review-log"), digest: attempts[2].artifact_digest },
  ];
  rebind(input);
  return {
    input,
    attempts,
    claim,
    profile: p,
    now: input.context.evaluated_at,
  };
}
test("P1 validates complete evidence tied to three actually completed attempt records", () => {
  const f = fixture();
  assert.equal(checkRunnerEvidence(f).status, "passed");
});
for (const fault of [
  "other issue",
  "other worker",
  "old generation",
  "missing log",
  "same context",
])
  test("P1 evidence cannot borrow " + fault, () => {
    const f = fixture();
    if (fault === "other issue") f.attempts[2].issue_number = 2;
    if (fault === "other worker") f.attempts[2].worker_id = "other";
    if (fault === "old generation") f.attempts[2].generation = 2;
    if (fault === "missing log")
      f.input.verifications[0].log_refs = [source("unrelated")];
    if (fault === "same context") f.attempts[2].context_id = "impl-1";
    let passed=false;try{passed=checkRunnerEvidence(f).status==="passed";}catch{}assert.equal(passed,false);
  });
