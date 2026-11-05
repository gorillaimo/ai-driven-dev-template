import test from "node:test";
import assert from "node:assert/strict";
import { createTrialBudget } from "../../tools/workflow-github/actions-budget.mjs";
import { fixture } from "./fixture.mjs";
import {
  createAuthorityProvider,
  verifyRunAuthorization,
  inspectCapability,
} from "../../tools/workflow-github/auth.mjs";
test("global trial budget reserves the hundredth HTTP request for token revocation", () => {
  let ms = 0;
  const b = createTrialBudget({ clock: () => ms });
  try {
    for (let i = 0; i < 99; i++) b.charge("GET", "/repos/a/b");
    assert.equal(b.requestCount, 99);
    assert.throws(() => b.charge("POST", "/repos/a/b/pulls"));
    ms = 880001;
    b.charge("DELETE", "/installation/token");
    assert.equal(b.requestCount, 100);
    assert.throws(() => b.charge("DELETE", "/installation/token"));
  } finally {
    b.close();
  }
});
test("expired active budget refuses API writes and closed budget cannot restart", () => {
  let ms = 0;
  const b = createTrialBudget({ clock: () => ms });
  ms = 880001;
  assert.throws(() => b.charge("POST", "/repos/a/b/git/refs"));
  b.close();
  assert.throws(() => b.charge("GET", "/repos/a/b"));
});
test("authority exposes informational execution bindings and an explicit mutation observation phase", async () => {
  const s = fixture(),
    phases = [];
  const p = createAuthorityProvider({
    mode: "trial",
    keys: s.issuerKeys,
    clock: () => s.snapshot.finished_at,
    journal: s.journal,
    observe: async (q) => {
      phases.push(q.phase);
      return structuredClone(s.state);
    },
  });
  try {
    const a = await verifyRunAuthorization(s.input, p);
    assert.equal(a.artifact.status, "allowed");
    assert.deepEqual(a.execution, s.state.execution);
    a.execution.generation = 99;
    await inspectCapability(a.capability, p, s.journal, { phase: "mutation" });
    assert.deepEqual(phases, ["admission", "mutation"]);
  } finally {
    s.close();
  }
});
