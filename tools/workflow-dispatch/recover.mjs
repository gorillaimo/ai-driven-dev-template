import { createClient } from "../workflow-github/client.mjs";
import { validateGitHubArtifact } from "../workflow-github/schema.mjs";
import { MAX } from "../workflow-github/core.mjs";
import { hash, pathValid, fail } from "./core.mjs";
// Read-only audit of an old receipt. Never mint an execution capability for an
// old generation, and never POST to "repair" an uncertain operation.
export async function auditReceipt(
  receipt,
  record,
  { transport, repository, repositoryId, claim, clock },
) {
  if (
    !validateGitHubArtifact("receipt", receipt).valid ||
    receipt.operation_id !== record.operation_id ||
    receipt.input_digest !== record.input_digest ||
    receipt.operation_kind !== record.kind ||
    receipt.repository !== repository ||
    receipt.repository_id !== repositoryId ||
    receipt.issue_number !== claim.issue_number ||
    receipt.run_id !== claim.run_id ||
    (record.kind !== "create_branch" &&
      (receipt.worker_id !== claim.worker_id ||
        receipt.generation !== claim.generation)) ||
    receipt.claim_id !== claim.claim_id ||
    receipt.branch !== claim.branch ||
    !pathValid(receipt.branch) ||
    !receipt.expected.terminal
  )
    fail("recovery_receipt_mismatch");
  const identity = await transport.identity();
  if (
    identity.actor_id !== record.actor_id ||
    !identity.repository_ids.includes(repositoryId) ||
    Date.parse(identity.expires_at) <= Date.parse(clock())
  )
    fail("recovery_actor_unknown");
  const readOnly = {
    async request(q) {
      if (q.method !== "GET") fail("recovery_write_forbidden");
      return transport.request(q);
    },
  };
  const client = createClient(readOnly, {
    repository,
    limits: { ...MAX, requests: 20, collector_seconds: 20 },
    clock,
  });
  const base = "/repos/" + repository,
    e = receipt.expected;
  let observed = null;
  if (e.kind === "branch" || e.kind === "ref") {
    const r = await client.request(
      "GET",
      base + "/git/ref/heads/" + receipt.branch,
    );
    if (
      r.status === 200 &&
      r.body.ref === "refs/heads/" + receipt.branch &&
      r.body.object?.sha === e.sha
    )
      observed = { sha: e.sha };
  } else if (e.kind === "comment") {
    const rows = await client.list(
      base + "/issues/" + receipt.issue_number + "/comments",
    );
    const matches = rows.filter(
      (c) =>
        c.user?.id === record.actor_id &&
        c.user?.type === "Bot" &&
        hash(c.body ?? "") === e.body_digest,
    );
    if (matches.length === 1)
      observed = { id: matches[0].id, body_digest: e.body_digest };
  } else if (e.kind === "pr") {
    const rows = await client.list(
      base +
        "/pulls?state=all&head=" +
        encodeURIComponent(repository.split("/")[0] + ":" + receipt.branch),
    );
    const matches = rows.filter(
      (p) =>
        p.user?.id === record.actor_id &&
        p.user?.type === "Bot" &&
        p.draft === true &&
        p.head?.ref === receipt.branch &&
        p.head?.sha === e.sha &&
        p.head?.repo?.id === repositoryId &&
        p.base?.ref === e.base &&
        hash(p.body ?? "") === e.body_digest,
    );
    if (matches.length === 1)
      observed = {
        id: matches[0].id,
        number: matches[0].number,
        sha: e.sha,
        body_digest: e.body_digest,
      };
  }
  if (!observed || receipt.request_count + client.requestCount > 100)
    fail("recovery_unresolved");
  return {
    ...receipt,
    status: "confirmed",
    recorded_at: clock(),
    request_count: receipt.request_count + client.requestCount,
    confirmed_steps: Math.max(receipt.confirmed_steps, receipt.step + 1),
    observed,
    partial: false,
    diagnostics: [],
  };
}
