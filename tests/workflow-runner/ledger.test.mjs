import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { profile, time } from "./fixture.mjs";
import { openLedger } from "../../tools/workflow-runner/ledger.mjs";
import { hash } from "../../tools/workflow-runner/core.mjs";
export function setup() {
  const directory = mkdtempSync(join(tmpdir(), "runner-ledger-"));
  chmodSync(directory, 0o700);
  const p = profile();
  return {
    directory,
    p,
    clean() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
export const admission = (p, intent = "continue") => ({
  event_id: "event-" + intent,
  nonce: "nonce-" + intent,
  run_id: "run-1",
  intent,
  request_digest: hash({ intent }),
  now: time,
});
export const attempt = (n = 1) => ({
  attempt_id: "attempt-" + n,
  run_id: "run-1",
  claim_id: "claim-" + n,
  worker_id: "worker-" + n,
  generation: 1,
  issue_number: n,
  role: "implementation",
  context_id: "context-" + n,
  head_sha: "1".repeat(40),
  now: time,
});
async function init(s) {
  const l = await openLedger({ directory: s.directory, profile: s.p });
  await l.admit(admission(s.p));
  return l;
}
test("attempt reservation is atomic, idempotent, capped and rejects changed replay", async () => {
  const s = setup();
  let l;
  try {
    l = await init(s);
    const q = attempt();
    const r = await Promise.allSettled([
      l.reserve(q),
      l.reserve({ ...q, attempt_id: "other" }),
    ]);
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
    const c = r.find((x) => x.status === "fulfilled").value;
    assert.equal(
      (await l.reserve({ ...q, attempt_id: c.attempt_id })).attempt_id,
      c.attempt_id,
    );
    await assert.rejects(
      l.reserve({ ...q, attempt_id: c.attempt_id, worker_id: "changed" }),
    );
    await l.reserve(attempt(2));
    await l.reserve(attempt(3));
    await assert.rejects(l.reserve(attempt(4)));
  } finally {
    await l?.close();
    s.clean();
  }
});
test("second writer, unsafe directory and old generation cannot mutate", async () => {
  const s = setup();
  let l;
  try {
    l = await init(s);
    await assert.rejects(openLedger({ directory: s.directory, profile: s.p }));
    const a = await l.reserve(attempt());
    await assert.rejects(
      l.observe({
        attempt_id: a.attempt_id,
        epoch: 0,
        status: "running",
        container_id: "fake-1",
        stopped: false,
        artifact_digest: null,
        now: time,
      }),
    );
  } finally {
    await l?.close();
    s.clean();
  }
});
test("stop fences requests while retaining live attempt and budget", async () => {
  const s = setup();
  let l;
  try {
    l = await init(s);
    await l.reserve(attempt());
    await l.admit(admission(s.p, "stop"));
    await assert.rejects(l.reserve(attempt(2)));
    const v = await l.view();
    assert.equal(v.attempts.length, 1);
    assert.equal(v.runs[0].stopped, true);
  } finally {
    await l?.close();
    s.clean();
  }
});
test("restart creates a recovery barrier instead of starting another worker", async () => {
  const s = setup();
  let l;
  try {
    l = await init(s);
    const a = await l.reserve(attempt());
    await l.close();
    l = await openLedger({ directory: s.directory, profile: s.p });
    const v = await l.view();
    assert.equal(v.recovery_required, true);
    assert.ok(v.epoch > a.epoch);
    await assert.rejects(l.reserve(attempt(2)));
  } finally {
    await l?.close();
    s.clean();
  }
});
test("unconfirmed model usage retains worst-case reservation after restart", async () => {
  const s = setup();
  s.p.limits.cost_microusd = 50000;
  let l;
  try {
    l = await init(s);
    const a = await l.reserve(attempt());
    const q = {
      request_id: "request-1",
      attempt_id: a.attempt_id,
      epoch: a.epoch,
      input_digest: "e".repeat(64),
      now: time,
    };
    const u = await l.reserveUsage(q);
    assert.ok(u.reserved_microusd > 0);
    await l.close();
    l = await openLedger({ directory: s.directory, profile: s.p });
    const v = await l.view();
    assert.equal(v.recovery_required, true);
    assert.equal(v.usage[0].status, "unknown");
    assert.equal(v.runs[0].spent, u.reserved_microusd);
    await assert.rejects(
      l.reserveUsage({ ...q, request_id: "request-2", epoch: v.epoch }),
    );
  } finally {
    await l?.close();
    s.clean();
  }
});
test("zero model budget prevents a request before any send", async () => {
  const s = setup();
  let l;
  try {
    l = await init(s);
    const a = await l.reserve(attempt());
    await assert.rejects(
      l.reserveUsage({
        request_id: "no-budget",
        attempt_id: a.attempt_id,
        epoch: a.epoch,
        input_digest: "f".repeat(64),
        now: time,
      }),
    );
    assert.deepEqual((await l.view()).usage, []);
  } finally {
    await l?.close();
    s.clean();
  }
});
