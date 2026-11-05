import test from "node:test";
import assert from "node:assert/strict";
import { verifyRunAuthorization } from "../../tools/workflow-github/auth.mjs";
import { fixture, fakeApi, time, hash } from "./fixture.mjs";
import { executeBrokerOperation } from "../../tools/workflow-github/broker.mjs";
test("another bot cannot supply this broker's trusted machine records", async () => {
  const s = fixture(),
    api = fakeApi();
  try {
    const { capability } = await verifyRunAuthorization(s.input, s.provider);
    api.refs.set(s.operation.branch, s.operation.expected_head);
    const o = {
      ...s.operation,
      kind: "append_claim",
      payload: { record_kind: "claim", status: "in_progress" },
    };
    assert.equal(
      (
        await executeBrokerOperation(o, capability, {
          transport: api,
          journal: s.journal,
          authorityProvider: s.provider,
        })
      ).status,
      "confirmed",
    );
    const row = api.comments[0];
    s.state.snapshot.sources.push({
      kind: "comment",
      id: row.id,
      issue_number: 1,
      actor_id: 123,
      actor_type: "Bot",
      updated_at: time,
      body_digest: hash(row.body),
      state: "active",
      machine: JSON.parse(
        row.body.slice("<!-- ai-workflow:github:v1 -->\n".length),
      ),
    });
    s.input.snapshot = structuredClone(s.state.snapshot);
    assert.equal(
      (await verifyRunAuthorization(s.input, s.provider)).artifact.status,
      "blocked",
    );
  } finally {
    s.close();
  }
});
test("signed human-attested request produces an opaque capability and bounded P1 facts", async () => {
  const s = fixture();
  try {
    const r = await verifyRunAuthorization(s.input, s.provider);
    assert.equal(r.artifact.status, "allowed", JSON.stringify(r.artifact));
    assert.ok(r.capability);
    assert.ok(r.artifact.not_evaluated.includes("real_human_identity"));
    assert.equal(r.facts.length, 6);
  } finally {
    s.close();
  }
});
for (const [name, change] of [
  ["unsigned AI transcription", (s) => (s.input.request.signature = "")],
  ["modified request", (s) => (s.input.request.payload.actor_id = 8)],
  [
    "wrong owner",
    (s) =>
      (s.input.request = s.signed("session-request", {
        ...s.request.payload,
        owner_id: 8,
      })),
  ],
  ["untrusted issuer", (s) => (s.input.request.issuer = "other")],
  [
    "expired request",
    (s) =>
      (s.input.request = s.signed("session-request", {
        ...s.request.payload,
        expires_at: "2026-11-04T00:09:59Z",
      })),
  ],
  [
    "edited approval",
    (s) => (s.state.snapshot.sources[1].body_digest = "f".repeat(64)),
  ],
  [
    "dismissed review",
    (s) => (s.state.snapshot.sources[1].state = "dismissed"),
  ],
  ["incomplete inventory", (s) => (s.state.snapshot.status = "partial")],
  [
    "missing bypass metadata",
    (s) => (s.state.snapshot.protections[0].bypass_actors = null),
  ],
  [
    "broker bypass",
    (s) => (s.state.snapshot.protections[0].bypass_actors = [99]),
  ],
  [
    "broad credential",
    (s) => (s.state.credential.permissions.administration = "write"),
  ],
  ["PAT", (s) => (s.state.credential.kind = "pat")],
  ["stop", (s) => (s.state.execution.stopped = true)],
  ["unreserved", (s) => (s.state.execution.reserved = false)],
  ["profile tamper", (s) => s.input.profile.allowed_paths.push("secrets")],
  ["source author spoof", (s) => (s.state.snapshot.sources[0].actor_id = 8)],
])
  test("authorization rejects " + name, async () => {
    const s = fixture();
    try {
      change(s);
      const r = await verifyRunAuthorization(s.input, s.provider);
      assert.equal(r.artifact.status, "blocked");
      assert.equal(r.capability, undefined);
      assert.ok(!JSON.stringify(r).includes("SECRET_CANARY"));
    } finally {
      s.close();
    }
  });
test("nonce cannot be reused for a different run", async () => {
  const s = fixture();
  try {
    assert.equal(
      (await verifyRunAuthorization(s.input, s.provider)).artifact.status,
      "allowed",
    );
    s.input.grant.run_id = "run-2";
    s.input.request = s.signed("session-request", {
      ...s.request.payload,
      run_id: "run-2",
    });
    assert.equal(
      (await verifyRunAuthorization(s.input, s.provider)).artifact.status,
      "blocked",
    );
  } finally {
    s.close();
  }
});
test("explicit delegate is bound to a numeric identity, not a reused login", async () => {
  for (const id of [8, 9]) {
    const s = fixture({
      delegate: { id: 8, login: "helper" },
      requestActor: { id, login: "helper" },
    });
    try {
      const r = await verifyRunAuthorization(s.input, s.provider);
      assert.equal(r.artifact.status, id === 8 ? "allowed" : "blocked");
    } finally {
      s.close();
    }
  }
});
test("trial facts remain unknown to P1 rather than proving real identity", async () => {
  const s = fixture();
  try {
    const r = await verifyRunAuthorization(s.input, s.provider);
    assert.equal(r.artifact.status, "allowed");
    assert.ok(r.facts.every((f) => f.value === "unknown"));
  } finally {
    s.close();
  }
});
test("fresh readback can change observation timestamps but cannot change authority data", async () => {
  const s = fixture();
  try {
    s.snapshot.started_at = "2026-11-04T00:09:59Z";
    s.snapshot.finished_at = "2026-11-04T00:09:59Z";
    assert.equal(
      (await verifyRunAuthorization(s.input, s.provider)).artifact.status,
      "allowed",
    );
    s.state.snapshot.sources[0].body_digest = "f".repeat(64);
    assert.equal(
      (await verifyRunAuthorization(s.input, s.provider)).artifact.status,
      "blocked",
    );
  } finally {
    s.close();
  }
});
