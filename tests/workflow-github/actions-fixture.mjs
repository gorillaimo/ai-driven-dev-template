import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { hash, PERMISSIONS } from "../../tools/workflow-github/core.mjs";
import { contractDigest } from "../../tools/workflow-github/collector.mjs";
import { gitObjectSha } from "../../tools/workflow-github/git.mjs";
import { prepareTrialKey } from "../../tools/workflow-github/actions-io.mjs";
export const actionsTime = "2026-11-05T06:30:00Z";
export function actionsFixture(change = () => {}) {
  const manifest = JSON.parse(
      readFileSync(
        new URL(
          "../../.ai-workflow/github-trial/manifest.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
    m = manifest,
    t = m.target;
  const issue = {
    id: 11,
    number: 1,
    state: "open",
    title: "Synthetic trial",
    body: "Synthetic bounded trial",
    assignees: [t.owner],
    labels: [{ name: "ready-for-ai" }],
    updated_at: actionsTime,
  };
  const comments = [21, 22].map((id, index) => ({
    id,
    body: index ? "Synthetic design source" : "Synthetic policy source",
    user: { ...t.owner, type: "User" },
    updated_at: actionsTime,
  }));
  m.approved_issue = { id: 11, contract_digest: contractDigest(issue) };
  m.manual_sources = comments.map((c) => ({
    id: c.id,
    body_digest: hash(c.body),
    actor_id: c.user.id,
    actor_type: "User",
    updated_at: c.updated_at,
  }));
  m.proof_sources = [21, 22];
  const calls = [],
    refs = new Map([[t.base_branch, t.base_sha]]),
    prs = [],
    blob = gitObjectSha("blob", "Synthetic README\n"),
    treeSha = gitObjectSha(
      "tree",
      Buffer.concat([
        Buffer.from("100644 README.md\0"),
        Buffer.from(blob, "hex"),
      ]),
    );
  const driver = async (request) => {
    calls.push(request);
    const u = new URL(request.path, "https://api.github.com"),
      p = u.pathname,
      base = "/repos/" + t.repository;
    let status = 200,
      body;
    if (p === "/app") body = { id: m.app.id, slug: "synthetic-app" };
    else if (p === "/app/installations/" + m.app.installation_id)
      body = {
        id: m.app.installation_id,
        app_id: m.app.id,
        suspended_at: null,
      };
    else if (p.endsWith("/access_tokens")) {
      status = 201;
      body = {
        token: "SYNTHETIC_TOKEN_CANARY",
        expires_at: "2026-11-05T07:30:00Z",
        permissions: { ...PERMISSIONS },
      };
    } else if (p === "/installation/repositories")
      body = {
        total_count: 1,
        repositories: [{ id: t.repository_id, full_name: t.repository }],
      };
    else if (p.startsWith("/users/"))
      body = { id: 99, login: "synthetic-app[bot]", type: "Bot" };
    else if (p === "/installation/token" && request.method === "DELETE") {
      status = 204;
      body = null;
    } else if (p === base)
      body = {
        id: t.repository_id,
        full_name: t.repository,
        default_branch: t.base_branch,
        owner: { ...t.owner, type: "User" },
      };
    else if (p === base + "/issues") body = [structuredClone(issue)];
    else if (p === base + "/issues/1") body = structuredClone(issue);
    else if (p === base + "/branches")
      body = [...refs].map(([name, sha]) => ({
        name,
        commit: { sha },
        protected: name === t.base_branch,
      }));
    else if (p === base + "/rulesets" || p === base + "/rules/branches/main")
      body = [];
    else if (p.endsWith("/protection"))
      body = {
        required_pull_request_reviews: {
          bypass_pull_request_allowances: { users: [], apps: [], teams: [] },
        },
        enforce_admins: { enabled: true },
        allow_force_pushes: { enabled: false },
        allow_deletions: { enabled: false },
      };
    else if (p.endsWith("/permission"))
      body = { user: t.owner, permission: "admin" };
    else if (p.includes("/git/ref/heads/")) {
      const name = p.split("/git/ref/heads/")[1];
      if (refs.has(name))
        body = { ref: "refs/heads/" + name, object: { sha: refs.get(name) } };
      else {
        status = 404;
        body = {};
      }
    } else if (p === base + "/git/refs" && request.method === "POST") {
      const name = request.body.ref.slice(11);
      if (refs.has(name)) {
        status = 422;
        body = {};
      } else {
        refs.set(name, request.body.sha);
        status = 201;
        body = { ref: request.body.ref, object: { sha: request.body.sha } };
      }
    } else if (p.includes("/git/refs/heads/") && request.method === "PATCH") {
      refs.set(t.branch, request.body.sha);
      body = {
        ref: "refs/heads/" + t.branch,
        object: { sha: request.body.sha },
      };
    } else if (p.includes("/git/commits/") && request.method === "GET")
      body = { sha: t.base_sha, tree: { sha: treeSha } };
    else if (p.includes("/git/trees/") && request.method === "GET")
      body = {
        sha: treeSha,
        truncated: false,
        tree: [{ path: "README.md", type: "blob", mode: "100644", sha: blob }],
      };
    else if (
      request.method === "POST" &&
      /\/git\/(blobs|trees|commits)$/.test(p)
    ) {
      const b = request.body;
      let raw, kind;
      if (p.endsWith("/blobs")) {
        kind = "blob";
        raw = Buffer.from(b.content, "base64");
      } else if (p.endsWith("/trees")) {
        kind = "tree";
        raw = Buffer.concat(
          b.tree.map((e) =>
            Buffer.concat([
              Buffer.from(
                (e.type === "tree" ? "40000" : e.mode) + " " + e.path + "\0",
              ),
              Buffer.from(e.sha, "hex"),
            ]),
          ),
        );
      } else {
        kind = "commit";
        const a = b.author,
          person =
            a.name +
            " <" +
            a.email +
            "> " +
            Math.floor(Date.parse(a.date) / 1000) +
            " +0000";
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
      status = 201;
      body = { sha: gitObjectSha(kind, raw) };
    } else if (p.endsWith("/comments") && request.method === "GET")
      body = structuredClone(comments);
    else if (p.endsWith("/comments") && request.method === "POST") {
      status = 201;
      body = {
        id: 500 + comments.length,
        body: request.body.body,
        user: { id: 99, type: "Bot" },
        updated_at: actionsTime,
      };
      comments.push(body);
    } else if (p === base + "/pulls" && request.method === "GET")
      body = structuredClone(prs);
    else if (p === base + "/pulls" && request.method === "POST") {
      status = 201;
      body = {
        id: 200,
        number: 2,
        title: request.body.title,
        body: request.body.body,
        user: { id: 99, type: "Bot" },
        state: "open",
        draft: true,
        head: {
          ref: t.branch,
          sha: refs.get(t.branch),
          repo: { id: t.repository_id },
        },
        base: { ref: t.base_branch, sha: t.base_sha },
      };
      prs.push(body);
    } else {
      status = 404;
      body = {};
    }
    const response = { status, headers: {}, body };
    await change(request, response);
    return response;
  };
  const root = mkdtempSync(join(tmpdir(), "actions-host-")),
    key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export(
      { type: "pkcs8", format: "pem" },
    ),
    paths = prepareTrialKey({
      runnerTemp: root,
      sourceRoot: new URL("../../", import.meta.url),
      key,
    });
  return {
    manifest,
    issue,
    comments,
    calls,
    refs,
    prs,
    paths,
    driver,
    options: {
      paths,
      manifest,
      sourceSha: "a".repeat(40),
      workflowSha: "b".repeat(40),
      runId: "trial-123",
      clock: () => actionsTime,
    },
    dependencies: { driver, mode: "synthetic" },
  };
}
