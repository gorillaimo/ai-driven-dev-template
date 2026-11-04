import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fixture, fakeApi, time } from "./fixture.mjs";
import { verifyRunAuthorization } from "../../tools/workflow-github/auth.mjs";
import { executeBrokerOperation } from "../../tools/workflow-github/broker.mjs";
import {
  buildGitObjects,
  gitObjectSha,
} from "../../tools/workflow-github/git.mjs";
const base = {
  sha: "2".repeat(40),
  tree: [],
  truncated: false,
  tree_sha: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
};
const changes = [
  {
    path: "src/example.txt",
    action: "set",
    mode: "100644",
    content: "hello\n",
  },
];
function nativeSha(kind, raw) {
  const r = spawnSync("git", ["hash-object", "-t", kind, "--stdin"], {
    input: raw,
  });
  assert.equal(r.status, 0, r.stderr?.toString());
  return r.stdout.toString().trim();
}
test("generated Git blob/tree/commit hashes agree with native Git", () => {
  const built = buildGitObjects({
    base,
    changes,
    operation_id: "publish-1",
    created_at: time,
    scope: { allowed_paths: ["src"], forbidden_paths: [] },
  });
  for (const o of built.objects) {
    let raw, type;
    if (o.kind === "blobs") {
      type = "blob";
      raw = Buffer.from(o.body.content, "base64");
    } else if (o.kind === "trees") {
      type = "tree";
      raw = Buffer.concat(
        o.body.tree.map((e) =>
          Buffer.concat([
            Buffer.from(
              (e.type === "tree" ? "40000" : e.mode) + " " + e.path + "\0",
            ),
            Buffer.from(e.sha, "hex"),
          ]),
        ),
      );
    } else {
      type = "commit";
      const b = o.body,
        p = b.author,
        date = Math.floor(Date.parse(p.date) / 1000),
        person = p.name + " <" + p.email + "> " + date + " +0000";
      raw = Buffer.from(
        "tree " +
          b.tree +
          "\nparent " +
          b.parents[0] +
          "\nauthor " +
          person +
          "\ncommitter " +
          person +
          "\n\n" +
          b.message,
      );
    }
    assert.equal(o.sha, nativeSha(type, raw));
  }
});
for (const lose of [false, true])
  test("publish commit readback, response loss=" + lose, async () => {
    const s = fixture(),
      api = fakeApi();
    api.refs.set(s.operation.branch, s.operation.expected_head);
    const op = {
        ...s.operation,
        kind: "publish_commit",
        operation_id: "publish-1",
        payload: { changes, created_at: time },
      },
      built = buildGitObjects({
        base,
        changes,
        operation_id: "publish-1",
        created_at: time,
        scope: { allowed_paths: ["src"], forbidden_paths: [] },
      });
    const transport = {
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
          api.calls.push(r);
          assert.equal(r.body.force, false);
          assert.equal(r.body.sha, built.commit.sha);
          api.refs.set(op.branch, r.body.sha);
          if (lose) throw Error("PRIVATE_RESPONSE");
          return {
            status: 200,
            headers: {},
            body: { object: { sha: r.body.sha } },
          };
        }
        return api.request(r);
      },
    };
    try {
      const { capability } = await verifyRunAuthorization(s.input, s.provider),
        ctx = { transport, journal: s.journal, authorityProvider: s.provider };
      const r = await executeBrokerOperation(op, capability, ctx);
      assert.equal(r.status, lose ? "unknown" : "confirmed", JSON.stringify(r));
      assert.equal(api.refs.get(op.branch), built.commit.sha);
      assert.equal(api.calls.filter((c) => c.method === "PATCH").length, 1);
      assert.ok(!JSON.stringify(r).includes("PRIVATE_RESPONSE"));
    } finally {
      s.close();
    }
  });
test("Draft PR update only accepts the same run and claim recorded in the journal", async () => {
  const s = fixture(),
    api = fakeApi();
  api.refs.set(s.operation.branch, s.operation.expected_head);
  const transport = {
    async request(r) {
      if (r.method === "GET" && /\/pulls\/5$/.test(r.path))
        return {
          status: 200,
          headers: {},
          body: {
            user: { id: 99, type: "Bot" },
            draft: true,
            state: "open",
            head: {
              ref: s.operation.branch,
              sha: s.operation.expected_head,
              repo: { id: 1 },
            },
            base: { ref: "main" },
          },
        };
      return api.request(r);
    },
  };
  try {
    const { capability } = await verifyRunAuthorization(s.input, s.provider);
    const old = {
      ...s.operation,
      kind: "create_draft_pr",
      operation_id: "old-pr",
      payload: { title: "Old PR" },
    };
    const ctx = {
      transport: api,
      journal: s.journal,
      authorityProvider: s.provider,
    };
    assert.equal(
      (await executeBrokerOperation(old, capability, ctx)).status,
      "confirmed",
    );
    const rows = s.journal.records().filter((r) => r.kind === "operation");
    const forged = rows.at(-1).receipt;
    forged.run_id = "other-run";
    const fakeJournal = {
      ...s.journal,
      records: () => [
        {
          kind: "operation",
          receipt: { ...forged, observed: { ...forged.observed, number: 5 } },
        },
      ],
    };
    // A separate journal cannot be substituted for the provider's journal either.
    const r = await executeBrokerOperation(
      {
        ...old,
        kind: "update_draft_pr",
        operation_id: "update-1",
        payload: { title: "Update", pr_number: 5 },
      },
      capability,
      { transport, journal: fakeJournal, authorityProvider: s.provider },
    );
    assert.notEqual(r.status, "confirmed");
    assert.equal(api.calls.filter((c) => c.method === "PATCH").length, 0);
  } finally {
    s.close();
  }
});
