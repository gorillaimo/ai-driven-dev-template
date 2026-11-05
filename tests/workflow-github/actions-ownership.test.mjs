import test from "node:test";
import assert from "node:assert/strict";
import { actionsFixture } from "./actions-fixture.mjs";
import { runActionsTrial } from "../../tools/workflow-github/actions-controller.mjs";
import {
  removeTrialKey,
  validTrialReport,
} from "../../tools/workflow-github/actions-io.mjs";

const base = "/repos/gorillaimo/ai-driven-dev-template-sandbox";
function personalFixture(change = () => {}) {
  return actionsFixture((q, r) => {
    if (q.path.endsWith("/protection"))
      delete r.body.required_pull_request_reviews
        .bypass_pull_request_allowances;
    change(q, r);
  });
}
async function blocked(change, expectedCode) {
  const s = personalFixture(change);
  try {
    const r = await runActionsTrial(s.options, s.dependencies);
    assert.equal(r.status, "blocked", JSON.stringify(r));
    if (expectedCode)
      assert.ok(
        r.diagnostics.some((d) => d.code === expectedCode),
        JSON.stringify(r.diagnostics),
      );
    assert.equal(
      s.calls.filter((q) => q.method !== "GET" && q.path.startsWith("/repos/"))
        .length,
      0,
    );
    assert.equal(r.token_revocation, "revoked");
    assert.equal(r.key_cleanup, "removed");
    assert.ok(validTrialReport(r));
    assert.ok(!JSON.stringify(r).includes("PRIVATE_OWNERSHIP_CANARY"));
    assert.ok(r.request_count <= 100);
  } finally {
    removeTrialKey(s.paths);
  }
}
test("observed personal ownership makes only the absent legacy bypass property inapplicable", async () => {
  const s = personalFixture();
  try {
    const r = await runActionsTrial(s.options, s.dependencies);
    assert.equal(r.status, "passed", JSON.stringify(r));
    assert.equal(r.receipts.length, 5);
    assert.ok(s.calls.filter((q) => q.path === base).length >= 2);
    assert.ok(r.request_count <= 100);
    assert.equal(r.request_count, s.calls.length);
    assert.equal(r.token_revocation, "revoked");
    assert.equal(r.key_cleanup, "removed");
    assert.ok(r.not_evaluated.includes("live_github"));
  } finally {
    removeTrialKey(s.paths);
  }
});
for (const [name, owner] of [
  ["organization", { id: 12776447, login: "gorillaimo", type: "Organization" }],
  ["missing", undefined],
  ["null", null],
  ["incomplete", {}],
  ["unknown type", { id: 12776447, login: "gorillaimo", type: "Other" }],
  ["invalid id", { id: 0, login: "gorillaimo", type: "User" }],
  ["wrong login", { id: 12776447, login: "other", type: "User" }],
])
  test("absent legacy bypass stays blocked for " + name + " ownership", () =>
    blocked((q, r) => {
      if (q.path === base) {
        if (owner === undefined) delete r.body.owner;
        else r.body.owner = owner;
        r.body.private_canary = "PRIVATE_OWNERSHIP_CANARY";
      }
    }),
  );
for (const [name, allowance] of [
  ["null", null],
  ["malformed", []],
  ["missing arrays", {}],
  ["partial arrays", { users: [], apps: [] }],
  ["nonempty users", { users: [{ id: 99 }], apps: [], teams: [] }],
  ["nonempty apps", { users: [], apps: [{ id: 99 }], teams: [] }],
  ["nonempty teams", { users: [], apps: [], teams: [{ id: 99 }] }],
])
  test("personal ownership never excuses " + name + " bypass metadata", () =>
    blocked((q, r) => {
      if (q.path.endsWith("/protection"))
        r.body.required_pull_request_reviews.bypass_pull_request_allowances =
          allowance;
    }),
  );
for (const [name, change] of [
  [
    "missing PR rule",
    (b) => {
      delete b.required_pull_request_reviews;
    },
  ],
  [
    "admin exemption",
    (b) => {
      b.enforce_admins.enabled = false;
    },
  ],
  [
    "force pushes",
    (b) => {
      b.allow_force_pushes.enabled = true;
    },
  ],
  [
    "deletions",
    (b) => {
      b.allow_deletions.enabled = true;
    },
  ],
])
  test("personal ownership never excuses " + name, () =>
    blocked((q, r) => {
      if (q.path.endsWith("/protection")) change(r.body);
    }),
  );
for (const [name, change] of [
  [
    "owner type",
    (r) => {
      r.body.owner.type = "Organization";
    },
  ],
  [
    "owner id",
    (r) => {
      r.body.owner.id++;
    },
  ],
  [
    "repository id",
    (r) => {
      r.body.id++;
    },
  ],
  [
    "repository name",
    (r) => {
      r.body.full_name = "other/repository";
    },
  ],
  [
    "unknown owner",
    (r) => {
      delete r.body.owner;
    },
  ],
  [
    "unavailable repository",
    (r) => {
      r.status = 403;
    },
  ],
])
  test(
    "ownership readback rejects changed " + name + " before any repo write",
    async () => {
      let reads = 0;
      await blocked((q, r) => {
        if (q.path === base && ++reads > 1) change(r);
      }, "repository_identity_changed");
    },
  );
test("personal ownership does not excuse missing ruleset bypass metadata", () =>
  blocked((q, r) => {
    const path = q.path.split("?")[0];
    if (path === base + "/rulesets")
      r.body = [{ id: 90, enforcement: "active" }];
    if (path === base + "/rulesets/90")
      r.body = { id: 90, enforcement: "active", rules: [] };
    if (path === base + "/rules/branches/main")
      r.body = [{ type: "pull_request", ruleset_id: 90 }];
  }, "protection_ruleset_bypass_unknown"));
