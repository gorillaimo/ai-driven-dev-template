import test from "node:test";
import assert from "node:assert/strict";
import { actionsFixture } from "./actions-fixture.mjs";
import { runActionsTrial } from "../../tools/workflow-github/actions-controller.mjs";
import {
  removeTrialKey,
  validTrialReport,
} from "../../tools/workflow-github/actions-io.mjs";
test("permission revoked after admission is detected immediately before the first write", async () => {
  let reads = 0;
  const s = actionsFixture((q, r) => {
    if (q.path.endsWith("/permission") && ++reads > 1)
      r.body.permission = "read";
  });
  try {
    const r = await runActionsTrial(s.options, s.dependencies);
    assert.notEqual(r.status, "passed");
    assert.equal(
      s.calls.filter((q) => q.method !== "GET" && q.path.startsWith("/repos/"))
        .length,
      0,
    );
    assert.equal(r.token_revocation, "revoked");
  } finally {
    removeTrialKey(s.paths);
  }
});
test("public exporter refuses a passing result without key cleanup", async () => {
  const s = actionsFixture();
  try {
    const r = await runActionsTrial(s.options, s.dependencies);
    assert.equal(r.status, "passed");
    assert.equal(validTrialReport({ ...r, key_cleanup: "pending" }), false);
  } finally {
    removeTrialKey(s.paths);
  }
});
test("a lost Draft PR response cannot leave a preceding machine report marked completed", async () => {
  const s = actionsFixture((q) => {
    if (q.method === "POST" && q.path.endsWith("/pulls"))
      throw Error("LOST_PR_RESPONSE");
  });
  try {
    const r = await runActionsTrial(s.options, s.dependencies);
    assert.equal(r.status, "unknown");
    const reports = s.comments
      .filter((c) => c.user.type === "Bot")
      .map((c) =>
        JSON.parse(c.body.slice("<!-- ai-workflow:github:v1 -->\n".length)),
      )
      .filter((v) => v.record_kind === "report");
    assert.equal(reports.length, 1);
    assert.notEqual(reports[0].record_status, "completed");
  } finally {
    removeTrialKey(s.paths);
  }
});
