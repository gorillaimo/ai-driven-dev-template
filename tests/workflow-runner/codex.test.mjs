import test from "node:test";
import assert from "node:assert/strict";
import { parseCodexEvents } from "../../tools/workflow-runner/codex.mjs";
const rows = [
  { type: "thread.started", thread_id: "11111111-1111-1111-1111-111111111111" },
  {
    type: "item.completed",
    item: { id: "item-1", type: "agent_message", text: '{"status":"passed"}' },
  },
  { type: "turn.completed", usage: { input_tokens: 20, output_tokens: 10 } },
];
test("Codex parser distinguishes an observed terminal event from a model summary", () => {
  const r = parseCodexEvents(rows.map((x) => JSON.stringify(x)).join("\n"));
  assert.equal(r.status, "completed");
  assert.equal(r.message, '{"status":"passed"}');
  assert.equal(r.provider_context_id, rows[0].thread_id);
});
for (const name of [
  "missing terminal",
  "duplicate context",
  "failure after success",
  "unknown usage",
  "oversized event",
])
  test("Codex parser rejects " + name, () => {
    const r = structuredClone(rows);
    if (name === "missing terminal") r.pop();
    if (name === "duplicate context") r.unshift(rows[0]);
    if (name === "failure after success")
      r.push({ type: "turn.failed", error: { message: "PRIVATE_CANARY" } });
    if (name === "unknown usage") delete r[2].usage;
    if (name === "oversized event") r[1].item.text = "a".repeat(1048577);
    assert.throws(() =>
      parseCodexEvents(r.map((x) => JSON.stringify(x)).join("\n")),
    );
  });
