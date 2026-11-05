import { inspectCapability } from "./auth.mjs";
import { badJson, hash, same, fail, NOT_EVALUATED } from "./core.mjs";
import { validateGitHubArtifact } from "./schema.mjs";
import { validateExecutionArtifact } from "workflow-execution/schema";

// Historical evidence only. A schema-valid event is never a broker capability.
export async function projectReceipt(
  receipt,
  capability,
  { journal, authorityProvider },
) {
  if (
    badJson(receipt) ||
    !validateGitHubArtifact("receipt", receipt).valid ||
    !same(journal.latest(receipt.operation_id), receipt)
  )
    fail("receipt_unverified");
  const data = await inspectCapability(capability, authorityProvider, journal),
    { policy, grant } = data.input,
    x = data.observed.execution;
  if (
    receipt.repository_id !== policy.repository_id ||
    receipt.repository !== policy.repository ||
    receipt.run_id !== grant.run_id ||
    receipt.policy_digest !== hash(policy) ||
    receipt.grant_digest !== hash(grant) ||
    receipt.claim_id !== x.claim_id ||
    receipt.worker_id !== x.worker_id ||
    receipt.generation !== x.generation ||
    receipt.branch !== x.branch ||
    !grant.selected.some((t) => t.issue_number === receipt.issue_number)
  )
    fail("receipt_binding_invalid");
  const event = {
    schema_version: 1,
    artifact_kind: "event",
    artifact_id: receipt.operation_id,
    revision: 1,
    repository: receipt.repository,
    recorded_at: data.now,
    recorded_by: {
      actor_type: "system",
      actor_ref: "github-app-" + data.observed.credential.app_id,
    },
    input_digest: receipt.input_digest,
    evidence_refs: [
      {
        kind: "source",
        id: receipt.operation_id,
        revision: 1,
        digest: hash(receipt),
        location: { kind: "id", target: receipt.operation_id },
      },
    ],
    run_id: receipt.run_id,
    profile: grant.profile,
    operation_id: receipt.operation_id,
    operation_kind: {
      create_branch: "branch",
      publish_commit: "push",
      append_claim: "claim",
      append_record: "record",
      create_draft_pr: "pr",
      update_draft_pr: "pr",
    }[receipt.operation_kind],
    issue_number: receipt.issue_number,
    status: ["prepared", "sending"].includes(receipt.status)
      ? "requested"
      : receipt.status,
    occurred_at: receipt.recorded_at,
    claim_id: receipt.claim_id,
    worker_id: receipt.worker_id,
    generation: receipt.generation,
  };
  if (!validateExecutionArtifact("event", event).valid)
    fail("projection_invalid");
  return { event, not_evaluated: [...NOT_EVALUATED] };
}
