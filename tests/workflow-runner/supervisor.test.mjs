import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sign } from "node:crypto";
import { profile, signedRequest, time } from "./fixture.mjs";
import {
  hash,
  canonical,
  ADAPTER_DIGEST,
} from "../../tools/workflow-runner/core.mjs";
import { createRunnerAuthority } from "../../tools/workflow-runner/authority.mjs";
import { createSyntheticAdapter } from "../../tools/workflow-runner/adapter.mjs";
import { openSupervisor } from "../../tools/workflow-runner/supervisor.mjs";
import { prepareWorkspace } from "../../tools/workflow-runner/workspace.mjs";
async function fixture(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "runner-supervisor-"));
  chmodSync(directory, 0o700);
  const execution_profile = (
    await import("../workflow-execution/fixture.mjs")
  ).fixture().profile;
  const p = profile({ execution_profile_digest: hash(execution_profile) }),
    claim = {
      claim_id: "claim-1",
      worker_id: "worker-1",
      generation: 1,
      issue_number: 1,
      run_id: "run-1",
      profile_digest: p.execution_profile_digest,
      allowed_paths: ["src", "tests"],
      forbidden_paths: ["secrets"],
      head_sha: "2".repeat(40),
      status: "ready",
      human_owner: "gorillaimo",
    },
    handle = Object.freeze({});
  let starts = 0,
    stops = 0;
  const calls = [];
  const s = signedRequest(p);
  const request = (intent) => {
    const r = signedRequest(p, intent, {
      event_id: "event-" + intent,
      nonce: "nonce-" + intent,
    });
    r.envelope.issuer = s.envelope.issuer;
    r.envelope.key_id = s.envelope.key_id;
    r.envelope.signature = sign(
      null,
      Buffer.from(
        "workflow-runner:v1:request\n" +
          canonical({
            issuer: r.envelope.issuer,
            key_id: r.envelope.key_id,
            payload: r.envelope.payload,
          }),
      ),
      s.privateKey,
    ).toString("base64");
    return r.envelope;
  };
  const authority = createRunnerAuthority({
    mode: "synthetic",
    keys: [s.key],
    clock: () => time,
    readSource: async ({ source_id }) => ({
      ...s.source,
      body_digest: hash(
        "workflow " +
          currentIntent +
          " run-1 " +
          hash(p) +
          " nonce-" +
          currentIntent,
      ),
    }),
  });
  let currentIntent = "continue";
  const adapter = createSyntheticAdapter({
    probe: async () => ({
      schema_version: 1,
      artifact_kind: "runner-capability",
      adapter_id: p.adapter_id,
      adapter_digest: ADAPTER_DIGEST,
      image: p.image,
      mode: "synthetic",
      observed_at: time,
      checks: Object.fromEntries(
        [
          "version",
          "noninteractive",
          "structured_output",
          "isolated_write",
          "network_none",
          "credential_separation",
          "resource_limits",
          "stop_tree",
          "resume",
          "usage",
          "model_gateway",
        ].map((k) => [k, options.missing !== k]),
      ),
      evidence_digest: "a".repeat(64),
    }),
    async start(q) {
      starts++;
      calls.push(q.role);
      await q.onCreated("synthetic-" + starts);
      return { n: starts, role: q.role, context_id: q.context_id };
    },
    async observe(h) {
      await options.wait?.();
      return {
        status: options.failed ? "failed" : "completed",
        stopped: true,
        context_id: h.context_id,
        artifact_digest: "e".repeat(64),
        output: {},
      };
    },
    async stop() {
      stops++;
      return { stopped: true };
    },
  });
  const dispatcher = {
    inspect: async () => ({ status: "ready", generation: 1, claims: [claim] }),
    handoff: async (h) => ({ status: h === handle ? "ready" : "blocked" }),
    stop: async () => {},
  };
  const supervisor = await openSupervisor({
    directory,
    profile: p,
    authority,
    adapter,
    dispatcher,
    mode: "synthetic",
    clock: () => time,
    prepareTask: async ({ attempt }) => {
      const d = join(directory, attempt.attempt_id);
      mkdirSync(d, { mode: 0o700 });
      return {
        workspace: prepareWorkspace({
          directory: d,
          profile: p,
          files: [{ path: "src/main.js", content: "Synthetic" }],
        }),
        prompt: "Synthetic task",
        execution_profile,
        command_id: "unit",
      };
    },
    evaluate: async ({ attempts }) =>
      options.evidence ?? {
        status: "blocked",
        diagnostics: ["evidence_not_evaluated"],
      },
  });
  return {
    p,
    supervisor,
    claim,
    handle,
    calls,
    get starts() {
      return starts;
    },
    get stops() {
      return stops;
    },
    async accept(intent = "continue") {
      currentIntent = intent;
      return supervisor.accept(request(intent), [
        { claim_id: claim.claim_id, handle },
      ]);
    },
    async close() {
      await supervisor.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
test("missing adapter capability refuses startup and retains the claim", async () => {
  const s = await fixture({ missing: "stop_tree" });
  try {
    const r = await s.accept();
    assert.equal(r.status, "blocked");
    assert.equal(s.starts, 0);
  } finally {
    await s.close();
  }
});
test("status is read-only and does not create a run or start a worker", async () => {
  const s = await fixture();
  try {
    const before = await s.supervisor.inspect();
    await s.accept("status");
    const after = await s.supervisor.inspect();
    assert.deepEqual(after, before);
    assert.equal(s.starts, 0);
  } finally {
    await s.close();
  }
});
test("a forged P4 handle cannot start a worker", async () => {
  const s = await fixture();
  try {
    const r = await s.supervisor.accept((await signedRequest(s.p)).envelope, [
      { claim_id: "claim-1", handle: {} },
    ]);
    assert.equal(r.status, "blocked");
    assert.equal(s.starts, 0);
  } finally {
    await s.close();
  }
});
test("the pipeline runs implementation, a verification attempt and separate review but does not invent success", async () => {
  const s = await fixture();
  try {
    const r = await s.accept();
    assert.equal(r.status, "blocked");
    assert.deepEqual(s.calls, ["implementation", "verification", "review"]);
    const v = await s.supervisor.inspect();
    assert.equal(v.attempts.length, 3);
    assert.equal(new Set(v.attempts.map((a) => a.context_id)).size, 3);
    assert.ok(v.attempts.every((a) => a.stopped));
  } finally {
    await s.close();
  }
});
test("a second continue during an active attempt never starts a duplicate", async () => {
  let release;
  const wait = new Promise((r) => (release = r));
  const s = await fixture({ wait: () => wait });
  try {
    const first = s.accept();
    while (!s.starts) await new Promise((r) => setTimeout(r, 5));
    const second = await s.accept();
    assert.equal(second.status, "running");
    assert.equal(s.starts, 1);
    release();
    await first;
  } finally {
    release();
    await s.close();
  }
});
test("stop wins over a pending worker and prevents subsequent review calls", async () => {
  let release;
  const wait = new Promise((r) => (release = r));
  const s = await fixture({ wait: () => wait });
  try {
    const first = s.accept();
    while (!s.starts) await new Promise((r) => setTimeout(r, 5));
    const stopped = await s.accept("stop");
    assert.equal(stopped.status, "stopped");
    assert.equal(s.stops, 1);
    release();
    assert.equal((await first).status, "stopped");
    assert.equal(s.starts, 1);
  } finally {
    release();
    await s.close();
  }
});
