import test from "node:test";
import assert from "node:assert/strict";
import { collectGitHubSnapshot } from "../../tools/workflow-github/collector.mjs";
import { fixture, apiIssue, time } from "./fixture.mjs";
function api(change = () => {}) {
  const calls = [];
  return {
    calls,
    async request(r) {
      calls.push(r);
      const u = new URL(r.path, "https://api.github.com"),
        path = u.pathname;
      let body =
        path === "/repos/example/synthetic"
          ? { id: 1, full_name: "example/synthetic", default_branch: "main" }
          : path.endsWith("/issues")
            ? [apiIssue()]
            : path.endsWith("/branches")
              ? [
                  {
                    name: "main",
                    commit: { sha: "2".repeat(40) },
                    protected: true,
                  },
                ]
              : [];
      if (path.endsWith("/issues/1")) body = apiIssue();
      const response = { status: 200, headers: {}, body };
      change(r, response);
      return response;
    },
  };
}
test("collector uses full lists and reports authority gaps without inventing permissions", async () => {
  const s = fixture(),
    a = api();
  try {
    const r = await collectGitHubSnapshot(
      { policy: s.policy, scope: { approval_sources: [], actors: [] } },
      a,
      () => time,
    );
    assert.equal(r.status, "complete", JSON.stringify(r));
    assert.equal(r.issues.length, 1);
    assert.equal(
      r.issues[0].contract_digest,
      s.grant.selected[0].contract_digest,
    );
    assert.ok(a.calls.every((c) => c.method === "GET"));
    assert.ok(!a.calls.some((c) => c.path.includes("/search/")));
    assert.equal(r.sections.permissions, "unknown");
  } finally {
    s.close();
  }
});
for (const [name, change] of [
  [
    "403",
    (_, r) => {
      r.status = 403;
    },
  ],
  [
    "traversal Link",
    (_, r) => {
      r.headers.link = '<https://evil.invalid/next>; rel="next"';
    },
  ],
  [
    "cycle Link",
    (_, r) => {
      r.headers.link =
        '<https://api.github.com/repos/example/synthetic/issues?state=all&per_page=100&page=1>; rel="next"';
    },
  ],
  [
    "wrong repo",
    (_, r) => {
      if (!Array.isArray(r.body)) r.body.id = 2;
    },
  ],
  [
    "duplicate Issue",
    (_, r) => {
      if (Array.isArray(r.body) && r.body[0]?.number) r.body.push(r.body[0]);
    },
  ],
])
  test("collector never calls incomplete " + name + " complete", async () => {
    const s = fixture();
    try {
      const r = await collectGitHubSnapshot(
        { policy: s.policy, scope: { approval_sources: [], actors: [] } },
        api(change),
        () => time,
      );
      assert.notEqual(r.status, "complete");
    } finally {
      s.close();
    }
  });
test("unknown keys/accessors/proxies never invoke code or leak", async () => {
  const s = fixture();
  try {
    let invoked = false;
    const input = Object.defineProperty({}, "policy", {
      enumerable: true,
      get() {
        invoked = true;
        throw Error("SECRET_CANARY");
      },
    });
    const a = api(),
      r = await collectGitHubSnapshot(input, a, () => time);
    assert.notEqual(r.status, "complete");
    assert.equal(invoked, false);
    assert.equal(a.calls.length, 0);
    assert.ok(!JSON.stringify(r).includes("SECRET_CANARY"));
  } finally {
    s.close();
  }
});
for (const mode of ["complete", "omitted bypass", "changed rules"])
  test("ruleset protection: " + mode, async () => {
    const s = fixture();
    let reads = 0;
    const a = api((r, v) => {
      const path = new URL(r.path, "https://api.github.com").pathname;
      if (path.endsWith("/protection")) {
        v.status = 404;
        v.body = {};
      }
      if (path.endsWith("/rulesets"))
        v.body = [{ id: 90, enforcement: "active" }];
      if (path.endsWith("/rulesets/90")) {
        v.body = {
          id: 90,
          enforcement: "active",
          rules: [
            { type: "pull_request" },
            { type: "non_fast_forward" },
            { type: "deletion" },
          ],
          ...(mode === "omitted bypass" ? {} : { bypass_actors: [] }),
        };
        if (mode === "changed rules" && ++reads > 1)
          v.body.enforcement = "disabled";
      }
      if (path.includes("/rules/branches/"))
        v.body = ["pull_request", "non_fast_forward", "deletion"].map(
          (type, i) => ({ id: i + 1, type, ruleset_id: 90 }),
        );
    });
    try {
      const r = await collectGitHubSnapshot(
        {
          policy: s.policy,
          scope: {
            approval_sources: [],
            actors: [],
            include_protections: true,
          },
        },
        a,
        () => time,
      );
      if (mode === "complete") {
        assert.equal(r.sections.protections, "complete", JSON.stringify(r));
        assert.equal(r.protections[0].enforced, true);
      } else if (mode === "omitted bypass")
        assert.equal(r.sections.protections, "unknown");
      else assert.notEqual(r.status, "complete");
      assert.ok(a.calls.every((c) => c.method === "GET"));
    } finally {
      s.close();
    }
  });
