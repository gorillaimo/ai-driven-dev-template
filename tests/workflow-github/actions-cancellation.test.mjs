import test from "node:test";
import assert from "node:assert/strict";
import { fixture, time } from "./fixture.mjs";
import { runLimitedTrial } from "../../tools/workflow-github/trial.mjs";
test("trial transport forwards callback cancellation to the actual request", async () => {
  const s = fixture();
  let cancelledBeforeCompletion = false;
  const transport = {
    request: async ({ signal }) =>
      new Promise((resolve) => {
        let aborted = signal.aborted;
        const timer = setTimeout(
          () => resolve({ status: 200, headers: {}, body: [] }),
          40,
        );
        if (aborted) {
          clearTimeout(timer);
          cancelledBeforeCompletion = true;
          resolve({ status: 200, headers: {}, body: [] });
        } else
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              cancelledBeforeCompletion = true;
              resolve({ status: 200, headers: {}, body: [] });
            },
            { once: true },
          );
      }),
  };
  try {
    let observed = false;
    await runLimitedTrial({
      enabled: true,
      mode: "synthetic",
      repository: s.policy.repository,
      repository_id: 1,
      issue_number: 1,
      operation_id: "branch-1",
      branch: s.operation.branch,
      path: "src/branch-1.txt",
      clock: () => time,
      keys: s.issuerKeys,
      journal: s.journal,
      transport,
      observe: async () => s.state,
      prepare: async ({ transport: t }) => {
        const c = new AbortController(),
          pending = t.request({
            method: "GET",
            path: "/repos/example/synthetic/issues",
            signal: c.signal,
          });
        c.abort();
        await pending.catch(() => {});
        observed = cancelledBeforeCompletion;
        throw Error("stop");
      },
    });
    assert.equal(observed, true);
  } finally {
    s.close();
  }
});
