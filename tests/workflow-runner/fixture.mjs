import { generateKeyPairSync, sign } from "node:crypto";
import { hash, canonical } from "../../tools/workflow-runner/core.mjs";
export const time = "2026-11-06T00:00:00Z";
export function profile(patch = {}) {
  return {
    schema_version: 1,
    artifact_kind: "runner-profile",
    id: "synthetic-runner",
    revision: 1,
    repository: "example/synthetic",
    repository_id: 1,
    human_owner: "gorillaimo",
    owner_id: 7,
    execution_profile_digest: "a".repeat(64),
    policy_digest: "b".repeat(64),
    adapter_id: "codex-0-166-0",
    adapter_digest:
      "a0bf572d2f93f056c6712a6da348e96078dc84f3885fd7be67807ef389cb3978",
    image: "sha256:" + "c".repeat(64),
    read_paths: ["src", "tests", "AGENTS.md"],
    write_paths: ["src", "tests"],
    forbidden_paths: ["secrets"],
    send_paths: ["src", "tests", "AGENTS.md"],
    model: {
      id: "synthetic-model",
      endpoint: "https://api.openai.com/v1/responses",
      context_tokens: 10000,
      input_microusd_per_million: 1000000,
      output_microusd_per_million: 2000000,
      pricing_digest: "d".repeat(64),
      pricing_expires_at: "2026-11-07T00:00:00Z",
    },
    limits: {
      max_ai_workers: 3,
      run_seconds: 600,
      call_seconds: 60,
      cleanup_seconds: 30,
      max_repairs: 3,
      memory_mib: 512,
      cpus: 1,
      pids: 64,
      scratch_mib: 64,
      max_requests: 10,
      max_input_tokens: 10000,
      max_output_tokens: 1000,
      cost_microusd: 0,
    },
    ...patch,
  };
}
export function signedRequest(p = profile(), intent = "continue", patch = {}) {
  const keys = generateKeyPairSync("ed25519"),
    payload = {
      event_id: "event-1",
      session_id: "session-1",
      nonce: "nonce-1",
      repository_id: p.repository_id,
      actor_id: p.owner_id,
      run_id: "run-1",
      runner_profile_digest: hash(p),
      intent,
      issued_at: time,
      expires_at: "2026-11-06T00:01:00Z",
      source_id: "123",
      source_updated_at: time,
      ...patch,
    };
  const body =
    "workflow " +
    payload.intent +
    " " +
    payload.run_id +
    " " +
    payload.runner_profile_digest +
    " " +
    payload.nonce;
  payload.source_digest = hash(body);
  const envelope = {
    schema_version: 1,
    artifact_kind: "runner-request",
    issuer: "synthetic-issuer",
    key_id: "key-1",
    payload,
  };
  envelope.signature = sign(
    null,
    Buffer.from(
      "workflow-runner:v1:request\n" +
        canonical({
          issuer: envelope.issuer,
          key_id: envelope.key_id,
          payload,
        }),
    ),
    keys.privateKey,
  ).toString("base64");
  return {
    envelope,
    privateKey: keys.privateKey,
    key: {
      issuer: "synthetic-issuer",
      key_id: "key-1",
      public_key: keys.publicKey.export({ type: "spki", format: "pem" }),
      expires_at: "2026-11-07T00:00:00Z",
    },
    source: {
      id: "123",
      repository_id: 1,
      actor_id: 7,
      actor_type: "User",
      permission: "admin",
      body_digest: hash(body),
      updated_at: time,
      observed_at: time,
      state: "active",
    },
  };
}
