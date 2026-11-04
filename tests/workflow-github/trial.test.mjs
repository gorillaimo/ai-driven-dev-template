import test from "node:test";
import assert from "node:assert/strict";
import { runLimitedTrial } from "../../tools/workflow-github/trial.mjs";
import { fixture, fakeApi, time, hash } from "./fixture.mjs";
import { buildGitObjects } from "../../tools/workflow-github/git.mjs";
test("unconfigured live trial is not_evaluated and never discovers credentials", async () => {
  const r = await runLimitedTrial();
  assert.equal(r.status, "not_evaluated");
  assert.ok(r.not_evaluated.includes("live_github"));
  assert.equal(r.request_count, 0);
});
test("trial refuses unsafe target/configuration before calling controller callbacks", async () => {
  let calls = 0;
  for (const change of [
    { branch: "main" },
    { repository: "bad" },
    { enabled: false },
    { path: ".github/workflows/x.yml" },
  ]) {
    const r = await runLimitedTrial({
      enabled: true,
      repository: "example/synthetic",
      repository_id: 1,
      issue_number: 1,
      operation_id: "trial-1",
      branch: "ai-work/1/trial-1",
      path: "src/trial.txt",
      clock: () => new Date().toISOString(),
      prepare: () => {
        calls++;
      },
      observe: () => {
        calls++;
      },
      ...change,
    });
    assert.notEqual(r.status, "confirmed");
  }
  assert.equal(calls, 0);
});
test("synthetic controller exercises the bounded five-operation trial without claiming live evidence", async () => {
  const s = fixture(),
    api = fakeApi(),
    changes = [
      {
        path: "src/branch-1.txt",
        action: "set",
        content: "workflow-github limited trial\n",
        mode: "100644",
      },
    ],
    base = {
      sha: s.operation.expected_head,
      tree: [],
      truncated: false,
      tree_sha: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
    },
    built = buildGitObjects({
      base,
      changes,
      operation_id: "branch-1-publish_commit",
      created_at: time,
      scope: { allowed_paths: ["src"], forbidden_paths: ["secrets"] },
    });
  const transport = {
    kind: "github_app",
    identity: async () => s.state.credential,
    async request(r) {
      const path = new URL(r.path, "https://api.github.com").pathname;
      if (r.method === "GET" && path.includes("/git/commits/"))
        return {
          status: 200,
          headers: {},
          body: { sha: base.sha, tree: { sha: base.tree_sha } },
        };
      if (r.method === "GET" && path.includes("/git/trees/"))
        return {
          status: 200,
          headers: {},
          body: { sha: base.tree_sha, tree: [], truncated: false },
        };
      if (r.method === "POST" && /\/git\/(blobs|trees|commits)$/.test(path)) {
        const object = built.objects.find(
          (o) =>
            o.kind === path.split("/").at(-1) &&
            JSON.stringify(o.body) === JSON.stringify(r.body),
        );
        assert.ok(object);
        return { status: 201, headers: {}, body: { sha: object.sha } };
      }
      if (r.method === "PATCH") {
        api.refs.set(s.operation.branch, r.body.sha);
        return {
          status: 200,
          headers: {},
          body: { object: { sha: r.body.sha } },
        };
      }
      return api.request(r);
    },
  };
  const config = {
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
    observe: async () => structuredClone(s.state),
    prepare: async ({ expected_head }) => {
      if (expected_head) {
        s.grant.selected[0].head_sha = expected_head;
        s.state.execution.expected_head = expected_head;
      }
      s.state.snapshot.branches = [...api.refs].map(([name, sha]) => ({
        name,
        sha,
        protected: name === "main",
      }));
      s.state.snapshot.sources = s.state.snapshot.sources.filter(
        (v) => v.actor_type === "User",
      );
      for (const row of api.comments)
        s.state.snapshot.sources.push({
          kind: "comment",
          id: row.id,
          issue_number: 1,
          actor_id: 99,
          actor_type: "Bot",
          updated_at: time,
          body_digest: hash(row.body),
          state: "active",
          machine: JSON.parse(
            row.body.slice("<!-- ai-workflow:github:v1 -->\n".length),
          ),
        });
      s.input.snapshot = structuredClone(s.state.snapshot);
      return s.input;
    },
  };
  try {
    const r = await runLimitedTrial(config);
    assert.equal(r.status, "confirmed", JSON.stringify(r));
    assert.equal(r.receipts.length, 5);
    assert.ok(r.request_count < 100);
    assert.equal(api.comments.length, 2);
    assert.equal(api.prs.length, 1);
    assert.ok(r.not_evaluated.includes("live_github"));
    assert.ok(r.not_evaluated.includes("real_human_identity"));
    assert.equal(
      (await runLimitedTrial({ ...config, mode: "live" })).status,
      "blocked",
    );
  } finally {
    s.close();
  }
});
