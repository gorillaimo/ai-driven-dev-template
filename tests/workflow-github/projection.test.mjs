import test from "node:test";
import assert from "node:assert/strict";
import { fixture, fakeApi } from "./fixture.mjs";
import { verifyRunAuthorization } from "../../tools/workflow-github/auth.mjs";
import { executeBrokerOperation } from "../../tools/workflow-github/broker.mjs";
import { projectReceipt } from "../../tools/workflow-github/projection.mjs";
import { validateExecutionArtifact } from "../../tools/workflow-execution/schema.mjs";
test("P1 projection requires the current capability and exact durable receipt", async () => {
  const s = fixture(),
    api = fakeApi(),
    ctx = { journal: s.journal, authorityProvider: s.provider, transport: api };
  try {
    const { capability } = await verifyRunAuthorization(s.input, s.provider);
    const r = await executeBrokerOperation(s.operation, capability, ctx);
    const result = await projectReceipt(r, capability, ctx);
    assert.equal(result.event.status, "confirmed");
    assert.equal(result.event.operation_kind, "branch");
    assert.equal(validateExecutionArtifact("event", result.event).valid, true);
    assert.ok(result.not_evaluated.includes("real_human_identity"));
    await assert.rejects(() =>
      projectReceipt({ ...r, status: "failed" }, capability, ctx),
    );
    await assert.rejects(() => projectReceipt(r, {}, ctx));
  } finally {
    s.close();
  }
});
