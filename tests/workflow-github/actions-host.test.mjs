import test from "node:test";
import assert from "node:assert/strict";
import { actionsFixture } from "./actions-fixture.mjs";
import { runActionsTrial } from "../../tools/workflow-github/actions-controller.mjs";
import {
  removeTrialKey,
  validTrialReport,
} from "../../tools/workflow-github/actions-io.mjs";
test("complete synthetic Actions host uses <=100 actual requests including issuance/revocation", async () => {
  const s = actionsFixture();
  try {
    const r = await runActionsTrial(s.options, s.dependencies);
    assert.equal(r.status, "passed", JSON.stringify(r));
    assert.equal(r.receipts.length, 5);
    assert.equal(r.token_revocation, "revoked");
    assert.equal(r.request_count, s.calls.length);
    assert.ok(r.request_count <= 100);
    assert.ok(r.not_evaluated.includes("live_github"));
    assert.ok(r.not_evaluated.includes("real_human_identity"));
    assert.ok(validTrialReport(r));
    assert.ok(!JSON.stringify(r).includes("SYNTHETIC_TOKEN_CANARY"));
    assert.equal(s.comments.length, 4);
    assert.equal(s.prs.length, 1);
  } finally {
    removeTrialKey(s.paths);
  }
});
for (const [name, change] of [
  [
    "missing bypass",
    (q, r) => {
      if (q.path === "/repos/gorillaimo/ai-driven-dev-template-sandbox")
        r.body.owner.type = "Organization";
      if (q.path.endsWith("/protection"))
        delete r.body.required_pull_request_reviews
          .bypass_pull_request_allowances;
    },
  ],
  [
    "wrong permission",
    (q, r) => {
      if (q.path.endsWith("/permission")) r.body.permission = "read";
    },
  ],
  [
    "wrong App",
    (q, r) => {
      if (q.path === "/app") r.body.id = 1;
    },
  ],
])
  test("Actions host stops before mutations on " + name, async () => {
    const s = actionsFixture(change);
    try {
      const r = await runActionsTrial(s.options, s.dependencies);
      assert.notEqual(r.status, "passed");
      assert.equal(
        s.calls.filter((q) => q.method !== "GET" && q.path.includes("/repos/"))
          .length,
        0,
      );
    } finally {
      removeTrialKey(s.paths);
    }
  });
test("lost POST response remains unknown and token is revoked", async () => {
  const s = actionsFixture((q) => {
    if (q.method === "POST" && q.path.endsWith("/comments"))
      throw Error("PRIVATE_RESPONSE_CANARY");
  });
  try {
    const r = await runActionsTrial(s.options, s.dependencies);
    assert.equal(r.status, "unknown", JSON.stringify(r));
    assert.equal(r.token_revocation, "revoked");
    assert.equal(
      s.calls.filter((q) => q.method === "POST" && q.path.endsWith("/comments"))
        .length,
      1,
    );
    assert.ok(!JSON.stringify(r).includes("PRIVATE_RESPONSE_CANARY"));
  } finally {
    removeTrialKey(s.paths);
  }
});
test("failed revocation is unknown instead of a passing report", async () => {
  const s = actionsFixture((q) => {
    if (q.method === "DELETE") throw Error("PRIVATE_TOKEN_CANARY");
  });
  try {
    const r = await runActionsTrial(s.options, s.dependencies);
    assert.equal(r.status, "unknown");
    assert.equal(r.token_revocation, "unknown");
    assert.ok(!JSON.stringify(r).includes("PRIVATE_TOKEN_CANARY"));
  } finally {
    removeTrialKey(s.paths);
  }
});
test("lost token-issuance response is unknown, not a claim that no token was issued", async () => {
  const s = actionsFixture((q) => {
    if (q.path.endsWith("/access_tokens"))
      throw Error("PRIVATE_ISSUANCE_CANARY");
  });
  try {
    const r = await runActionsTrial(s.options, s.dependencies);
    assert.equal(r.status, "unknown");
    assert.equal(r.token_revocation, "unknown");
    assert.ok(!JSON.stringify(r).includes("PRIVATE_ISSUANCE_CANARY"));
  } finally {
    removeTrialKey(s.paths);
  }
});
test("every repo mutation is preceded by issue, source, permission and protection readbacks", async () => {
  const s = actionsFixture();
  try {
    const r = await runActionsTrial(s.options, s.dependencies);
    assert.equal(r.status, "passed");
    let writes = 0;
    for (let i = 0; i < s.calls.length; i++) {
      const q = s.calls[i];
      if (
        ["POST", "PATCH"].includes(q.method) &&
        q.path.startsWith("/repos/")
      ) {
        writes++;
        const recent = s.calls
          .slice(Math.max(0, i - 5), i)
          .filter((v) => v.method === "GET");
        for (const suffix of [
          "/issues/1",
          "/comments",
          "/permission",
          "/protection",
        ])
          assert.ok(
            recent.some((v) => v.path.split("?")[0].endsWith(suffix)),
            q.path + " missing " + suffix,
          );
      }
    }
    assert.equal(writes, 9);
  } finally {
    removeTrialKey(s.paths);
  }
});

for (const [name, change, code] of [
  [
    "bypass object",
    (r) => {
      delete r.body.required_pull_request_reviews
        .bypass_pull_request_allowances;
    },
    "protection_legacy_bypass_missing",
  ],
  ...["users", "apps", "teams"].map((key) => [
    key,
    (r) => {
      delete r.body.required_pull_request_reviews
        .bypass_pull_request_allowances[key];
    },
    "protection_legacy_bypass_" + key + "_missing",
  ]),
  [
    "team membership",
    (r) => {
      r.body.required_pull_request_reviews.bypass_pull_request_allowances.teams.push(
        { id: 42 },
      );
    },
    "protection_legacy_team_bypass_unknown",
  ],
  [
    "forbidden read",
    (r) => {
      r.status = 403;
      r.body = { message: "PRIVATE_PROTECTION_CANARY" };
    },
    "protection_legacy_read_forbidden",
  ],
  [
    "admin enforcement",
    (r) => {
      r.body.enforce_admins.enabled = false;
    },
    "protection_legacy_admins_not_enforced",
  ],
  [
    "no protection",
    (r) => {
      r.status = 404;
      r.body = {};
    },
    "protection_required_rules_missing",
  ],
])
  test(
    "blocked Actions report identifies " +
      name +
      " without publishing raw settings",
    async () => {
      const s = actionsFixture((q, r) => {
        if (
          name === "bypass object" &&
          q.path === "/repos/gorillaimo/ai-driven-dev-template-sandbox"
        )
          r.body.owner.type = "Organization";
        if (q.path.endsWith("/protection")) {
          change(r);
          r.body.private_canary = "PRIVATE_PROTECTION_CANARY";
        }
      });
      try {
        const r = await runActionsTrial(s.options, s.dependencies);
        assert.equal(r.status, "blocked");
        assert.ok(
          r.diagnostics.some((d) => d.code === code),
          JSON.stringify(r.diagnostics),
        );
        assert.equal(
          s.calls.filter(
            (q) => q.method !== "GET" && q.path.includes("/repos/"),
          ).length,
          0,
        );
        assert.equal(r.token_revocation, "revoked");
        assert.equal(r.key_cleanup, "removed");
        assert.ok(validTrialReport(r));
        assert.ok(!JSON.stringify(r).includes("PRIVATE_PROTECTION_CANARY"));
        assert.ok(r.request_count <= 100);
      } finally {
        removeTrialKey(s.paths);
      }
    },
  );
