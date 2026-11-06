import test from "node:test";
import assert from "node:assert/strict";
import { profile, time } from "./fixture.mjs";
import { createGateway } from "../../tools/workflow-runner/gateway.mjs";
function fixture() {
  const p = profile();
  p.limits.cost_microusd = 100000;
  let reserved = 0,
    settled = 0,
    sent = 0;
  const ledger = {
    async reserveUsage() {
      reserved++;
      return {};
    },
    async settleUsage() {
      settled++;
      return {};
    },
  };
  const gateway = createGateway({
    mode: "synthetic",
    profile: p,
    ledger,
    clock: () => time,
    observeAttempt: async () => ({
      active: true,
      stopped: false,
      attempt_id: "attempt-1",
      run_id: "run-1",
      epoch: 1,
    }),
    upstream: async (request) => {
      sent++;
      return {
        status: 200,
        body: JSON.stringify({
          id: "response-1",
          usage: { input_tokens: 30, output_tokens: 10 },
          output: [],
        }),
        content_type: "application/json",
      };
    },
  });
  return { p, gateway, counts: () => ({ reserved, settled, sent }) };
}
test("gateway reserves before sending and uses provider usage for settlement", async () => {
  const s = fixture();
  const r = await s.gateway.request(
    {
      method: "POST",
      path: "/v1/responses",
      body: {
        model: s.p.model.id,
        input: "Synthetic",
        max_output_tokens: 100,
        stream: false,
      },
    },
    "attempt-1",
  );
  assert.equal(r.status, 200);
  assert.deepEqual(s.counts(), { reserved: 1, settled: 1, sent: 1 });
});
for (const [name, change] of [
  ["other route", (r) => (r.path = "/v1/files")],
  ["query", (r) => (r.path += "?x=1")],
  ["different model", (r) => (r.body.model = "other")],
  ["excess output", (r) => (r.body.max_output_tokens = 2000)],
  ["remote tool", (r) => (r.body.tools = [{ type: "web_search" }])],
  [
    "URL input",
    (r) =>
      (r.body.input = [
        { type: "input_file", file_url: "https://example.invalid/private" },
      ]),
  ],
])
  test("gateway blocks " + name + " before upstream", async () => {
    const s = fixture(),
      q = {
        method: "POST",
        path: "/v1/responses",
        body: {
          model: s.p.model.id,
          input: "Synthetic",
          max_output_tokens: 100,
        },
      };
    change(q);
    await assert.rejects(s.gateway.request(q, "attempt-1"));
    assert.equal(s.counts().sent, 0);
  });
test("missing usage holds a reservation and blocks further model calls", async () => {
  const s = fixture();
  const gateway = createGateway({
    mode: "synthetic",
    profile: s.p,
    clock: () => time,
    ledger: {
      reserveUsage: async () => ({}),
      settleUsage: async () => assert.fail(),
    },
    observeAttempt: async () => ({
      active: true,
      stopped: false,
      attempt_id: "attempt-1",
      run_id: "run-1",
      epoch: 1,
    }),
    upstream: async () => ({
      status: 200,
      body: "{}",
      content_type: "application/json",
    }),
  });
  await assert.rejects(
    gateway.request(
      {
        method: "POST",
        path: "/v1/responses",
        body: { model: s.p.model.id, input: "Synthetic" },
      },
      "attempt-1",
    ),
  );
  await assert.rejects(
    gateway.request(
      {
        method: "POST",
        path: "/v1/responses",
        body: { model: s.p.model.id, input: "Synthetic" },
      },
      "attempt-1",
    ),
  );
});
