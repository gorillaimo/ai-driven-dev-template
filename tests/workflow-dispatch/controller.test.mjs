import test from "node:test";
import assert from "node:assert/strict";
import { controllerFixture } from "./controller-fixture.mjs";
import { openDispatcher } from "../../tools/workflow-dispatch/controller.mjs";
test("only an opaque controller authority can open the dispatcher", async () => {
  await assert.rejects(
    openDispatcher({ authority: { mode: "synthetic", approved: true } }),
  );
});
test("P3 authorization gets reservation truth from SQLite and a forged handle cannot mutate", async () => {
  const s = await controllerFixture();
  try {
    const r = await s.dispatcher.reserve(s.f);
    assert.equal(r.reservations.length, 1, JSON.stringify(r));
    const { claim, handle } = r.reservations[0];
    assert.equal(s.api.calls.length, 0);
    for (const forged of [
      {},
      JSON.parse(JSON.stringify(handle)),
      { claim_id: claim.claim_id, reserved: true },
    ])
      assert.notEqual(
        (await s.dispatcher.execute(forged, s.operation(claim))).status,
        "confirmed",
      );
    assert.equal(s.api.calls.length, 0);
    assert.equal(
      (await s.dispatcher.execute(handle, s.operation(claim))).status,
      "confirmed",
    );
  } finally {
    await s.close();
  }
});
test("bad signature cannot turn a provisional reservation into execution authority", async () => {
  const s = await controllerFixture({
    changeAuthorization: (i) => (i.request.signature = "A".repeat(88)),
  });
  try {
    const r = await s.dispatcher.reserve(s.f);
    assert.equal(r.reservations.length, 0);
    assert.equal((await s.dispatcher.inspect()).claims.length, 0);
    assert.equal(s.api.calls.length, 0);
  } finally {
    await s.close();
  }
});
test("a valid handle is still tied to exactly its issue and worker", async () => {
  const s = await controllerFixture();
  try {
    const r = await s.dispatcher.reserve(s.f),
      { claim, handle } = r.reservations[0];
    for (const patch of [
      { issue_number: 2 },
      { worker_id: "other" },
      { generation: claim.generation + 1 },
    ])
      assert.notEqual(
        (
          await s.dispatcher.execute(handle, {
            ...s.operation(claim),
            ...patch,
          })
        ).status,
        "confirmed",
      );
    assert.equal(s.api.calls.length, 0);
  } finally {
    await s.close();
  }
});
test("stop detected at the P3 mutation check prevents the HTTP write", async () => {
  let stop = false;
  const s = await controllerFixture({
    observe: async (q, d) => {
      if (stop && q.phase === "mutation") await d.stop("run-1");
    },
  });
  try {
    const r = await s.dispatcher.reserve(s.f),
      { claim, handle } = r.reservations[0];
    stop = true;
    assert.notEqual(
      (await s.dispatcher.execute(handle, s.operation(claim))).status,
      "confirmed",
    );
    assert.equal(s.api.calls.filter((q) => q.method === "POST").length, 0);
  } finally {
    await s.close();
  }
});
test("handoff waits for both branch and claim readbacks", async () => {
  const s = await controllerFixture();
  try {
    const r = await s.dispatcher.reserve(s.f),
      { claim, handle } = r.reservations[0];
    assert.equal((await s.dispatcher.handoff(handle)).status, "blocked");
    assert.equal(
      (await s.dispatcher.execute(handle, s.operation(claim))).status,
      "confirmed",
    );
    assert.equal((await s.dispatcher.handoff(handle)).status, "blocked");
    assert.equal(
      (await s.dispatcher.execute(handle, s.operation(claim, "append_claim")))
        .status,
      "confirmed",
    );
    assert.equal((await s.dispatcher.handoff(handle)).status, "ready");
  } finally {
    await s.close();
  }
});
test("lost claim response is held and audited without repeating the POST", async () => {
  const s = await controllerFixture();
  try {
    const r = await s.dispatcher.reserve(s.f),
      { claim, handle } = r.reservations[0];
    await s.dispatcher.execute(handle, s.operation(claim));
    s.api.loseNext("comment");
    assert.equal(
      (await s.dispatcher.execute(handle, s.operation(claim, "append_claim")))
        .status,
      "unknown",
    );
    assert.equal((await s.dispatcher.inspect()).pending_operations.length, 1);
    const before = s.api.calls.filter((q) => q.method === "POST").length;
    const v = await s.dispatcher.inspect();
    const recovery = {
      claims: v.claims.map((c) => ({
        claim_id: c.claim_id,
        old_generation: c.generation,
        action: "resume",
        worker_id: "recovered-worker",
        head_sha: c.head_sha,
      })),
    };
    assert.equal((await s.dispatcher.recover(recovery)).status, "passed");
    assert.equal(s.api.calls.filter((q) => q.method === "POST").length, before);
    assert.equal((await s.dispatcher.inspect()).pending_operations.length, 0);
    assert.notEqual(
      (await s.dispatcher.execute(handle, s.operation(claim, "append_claim")))
        .status,
      "confirmed",
    );
  } finally {
    await s.close();
  }
});
test("verified worker completion frees only execution capacity, not the review claim", async () => {
  const s = await controllerFixture();
  try {
    const r = await s.dispatcher.reserve(s.f),
      { claim, handle } = r.reservations[0];
    const transition = {
      schema_version: 1,
      artifact_kind: "transition",
      claim_id: claim.claim_id,
      worker_id: claim.worker_id,
      generation: claim.generation,
      status: "in_review",
      head_sha: claim.head_sha,
      evidence_refs: [
        {
          kind: "source",
          id: "worker-result",
          revision: 1,
          digest: "a".repeat(64),
          location: { kind: "id", target: "worker-result" },
        },
      ],
    };
    assert.equal(
      (await s.dispatcher.transition(handle, transition)).status,
      "passed",
    );
    const v = await s.dispatcher.inspect();
    assert.equal(v.claims.length, 1);
    assert.equal(v.claims[0].execution_active, false);
    assert.equal(v.claims[0].status, "in_review");
  } finally {
    await s.close();
  }
});
