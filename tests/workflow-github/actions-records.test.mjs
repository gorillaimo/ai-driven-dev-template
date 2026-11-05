import test from "node:test";
import assert from "node:assert/strict";
import { fixture, hash, time } from "./fixture.mjs";
import { createTrialRecordFactory } from "../../tools/workflow-github/actions-records.mjs";
import {
  createAuthorityProvider,
  verifyRunAuthorization,
} from "../../tools/workflow-github/auth.mjs";
import { validateExecutionArtifact } from "../../tools/workflow-execution/schema.mjs";
import { validateGitHubArtifact } from "../../tools/workflow-github/schema.mjs";
export function syntheticManifest(s) {
  return {
    version: 1,
    host: {
      repository: "gorillaimo/ai-driven-dev-template",
      repository_id: 1225812134,
    },
    target: {
      repository: s.policy.repository,
      repository_id: 1,
      issue_number: 1,
      owner: { id: 7, login: "gorillaimo" },
      base_branch: "main",
      base_sha: "2".repeat(40),
      operation_id: "trial-1",
      branch: "ai-work/1/trial-1",
      path: "src/trial-1.txt",
    },
    app: { id: 9, installation_id: 10 },
    approved_issue: {
      id: 11,
      contract_digest: s.grant.selected[0].contract_digest,
    },
    manual_sources: s.snapshot.sources.map((v) => ({
      id: v.id,
      body_digest: v.body_digest,
      actor_id: v.actor_id,
      actor_type: v.actor_type,
      updated_at: v.updated_at,
    })),
    proof_sources: [21, 22],
  };
}
test("trial records bind actual observed sources, current head, manifest and ephemeral synthetic issuer", async () => {
  const s = fixture();
  try {
    const f = createTrialRecordFactory({
      manifest: syntheticManifest(s),
      sourceSha: "a".repeat(40),
      runId: "trial-123",
      clock: () => time,
    });
    const snap = structuredClone(s.snapshot);
    snap.policy_digest = hash(f.policy);
    const r = f.make(snap, s.state.credential, "2".repeat(40));
    assert.equal(
      validateExecutionArtifact("profile", r.input.profile).valid,
      true,
    );
    assert.equal(validateExecutionArtifact("grant", r.input.grant).valid, true);
    assert.equal(validateGitHubArtifact("policy", r.input.policy).valid, true);
    const provider = createAuthorityProvider({
      mode: "trial",
      keys: f.keys,
      clock: () => time,
      journal: s.journal,
      observe: async () => ({
        api_requests: 0,
        snapshot: snap,
        execution: r.execution,
        credential: s.state.credential,
      }),
    });
    const a = await verifyRunAuthorization(r.input, provider);
    assert.equal(a.artifact.status, "allowed", JSON.stringify(a.artifact));
    assert.ok(a.facts.every((v) => v.value === "unknown"));
    assert.ok(!JSON.stringify(r).includes("PRIVATE KEY"));
  } finally {
    s.close();
  }
});
test("record factory refuses changed contract, missing source and edited source instead of manufacturing proof", () => {
  const s = fixture();
  try {
    const f = createTrialRecordFactory({
      manifest: syntheticManifest(s),
      sourceSha: "a".repeat(40),
      runId: "trial-123",
      clock: () => time,
    });
    for (const change of [
      (v) => (v.issues[0].contract_digest = "f".repeat(64)),
      (v) => v.sources.pop(),
      (v) => (v.sources[0].body_digest = "f".repeat(64)),
    ]) {
      const snap = structuredClone(s.snapshot);
      snap.policy_digest = hash(f.policy);
      change(snap);
      assert.throws(() => f.make(snap, s.state.credential, "2".repeat(40)));
    }
  } finally {
    s.close();
  }
});
