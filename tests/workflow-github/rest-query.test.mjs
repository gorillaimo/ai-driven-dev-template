import test from "node:test";
import assert from "node:assert/strict";
import { createRestTransport } from "../../tools/workflow-github/transport.mjs";
test("REST allows encoded branch separators in a PR filter but refuses them in endpoint paths", async () => {
  const calls = [],
    t = createRestTransport(
      { repository: "example/synthetic", repositoryId: 1 },
      async (q) => {
        calls.push(q);
        return { status: 200, headers: {}, body: [] };
      },
    );
  await t.request({
    method: "GET",
    path: "/repos/example/synthetic/pulls?state=all&head=example%3Aai-work%2F1%2Ftrial&base=main",
  });
  await assert.rejects(() =>
    t.request({
      method: "GET",
      path: "/repos/example/synthetic/branches/main%2Fother",
    }),
  );
  assert.equal(calls.length, 1);
});
test("endpoint dot segments stay forbidden before URL normalization", async () => {
  const t = createRestTransport(
    { repository: "example/synthetic", repositoryId: 1 },
    async () => ({ status: 200, headers: {}, body: [] }),
  );
  for (const path of [
    "/repos/example/synthetic/issues/%2e%2e/pulls",
    "/repos/example/synthetic/issues/../pulls",
  ])
    await assert.rejects(() => t.request({ method: "GET", path }));
});
