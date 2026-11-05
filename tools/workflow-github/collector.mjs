import { badJson, hash, same, nowValid, fail, errorCode } from "./core.mjs";
import { validateGitHubArtifact as validate } from "./schema.mjs";
import { createClient } from "./client.mjs";
import { collectProtections } from "./protection.mjs";
export const contractDigest = (i) =>
  hash({
    id: i.id,
    number: i.number,
    title: i.title,
    body: i.body,
    assignees: i.assignees.map((a) => ({ id: a.id, login: a.login })),
    labels: i.labels.map((a) => a.name).sort(),
  });
const SECTIONS = [
  "issues",
  "prs",
  "branches",
  "comments",
  "reviews",
  "permissions",
  "protections",
];
export async function collectGitHubSnapshot(
  input,
  transport,
  clock = () => new Date().toISOString(),
) {
  const start = clock(),
    result = {
      schema_version: 1,
      artifact_kind: "github-snapshot",
      repository: "unknown/unknown",
      repository_id: 1,
      started_at: nowValid(start) ? start : new Date(0).toISOString(),
      finished_at: nowValid(start) ? start : new Date(0).toISOString(),
      status: "unavailable",
      policy_digest: "0".repeat(64),
      default_branch: "unknown",
      sections: Object.fromEntries(SECTIONS.map((k) => [k, "unknown"])),
      issues: [],
      prs: [],
      branches: [],
      sources: [],
      permissions: [],
      protections: [],
      pages: [],
      unresolved: [],
    };
  try {
    if (
      badJson(input) ||
      !input ||
      Object.keys(input).some((k) => !["policy", "scope"].includes(k)) ||
      !validate("policy", input.policy).valid ||
      !input.scope ||
      Object.keys(input.scope).some(
        (k) =>
          !["approval_sources", "actors", "include_protections"].includes(k),
      ) ||
      !Array.isArray(input.scope.approval_sources) ||
      !Array.isArray(input.scope.actors) ||
      input.scope.approval_sources.length > 1000 ||
      input.scope.actors.length > 100 ||
      !nowValid(start)
    )
      fail("input_invalid");
    const { policy: p, scope } = input,
      base = "/repos/" + p.repository,
      client = createClient(transport, {
        repository: p.repository,
        limits: p.limits,
        clock,
      });
    Object.assign(result, {
      repository: p.repository,
      repository_id: p.repository_id,
      policy_digest: hash(p),
      pages: client.pages,
      status: "partial",
    });
    const repo = await client.request("GET", base);
    if (
      repo.status !== 200 ||
      repo.body.id !== p.repository_id ||
      repo.body.full_name !== p.repository ||
      typeof repo.body.default_branch !== "string"
    )
      fail("repository_mismatch");
    result.default_branch = repo.body.default_branch;
    const paths = {
      issues: base + "/issues?state=all&sort=created&direction=asc",
      prs: base + "/pulls?state=all&sort=created&direction=asc",
      branches: base + "/branches",
    };
    const first = {};
    for (const kind of ["issues", "prs", "branches"])
      first[kind] = await client.list(paths[kind]);
    const issueRows = first.issues.filter((i) => !i.pull_request);
    for (const i of issueRows) {
      if (
        !Array.isArray(i.assignees) ||
        !Array.isArray(i.labels) ||
        (typeof i.body !== "string" && i.body !== null) ||
        typeof i.title !== "string" ||
        !nowValid(i.updated_at)
      )
        fail("resource_invalid");
      const row = { ...i, body: i.body ?? "" };
      result.issues.push({
        id: i.id,
        number: i.number,
        state: i.state,
        assignees: i.assignees.map((a) => ({ id: a.id, login: a.login })),
        labels: i.labels.map((a) => a.name),
        updated_at: i.updated_at,
        body_digest: hash(row.body),
        contract_digest: contractDigest(row),
      });
    }
    result.branches = first.branches.map((b) => ({
      name: b.name,
      sha: b.commit?.sha,
      protected: b.protected,
    }));
    for (const pr of first.prs) {
      const r = await client.request("GET", base + "/pulls/" + pr.number);
      if (r.status !== 200) fail("resource_unknown");
      const v = r.body;
      result.prs.push({
        id: v.id,
        number: v.number,
        state: v.state,
        draft: v.draft,
        head_branch: v.head?.ref,
        head_sha: v.head?.sha,
        base_branch: v.base?.ref,
        base_sha: v.base?.sha,
        head_repository_id: v.head?.repo?.id,
        merged: v.merged,
        updated_at: v.updated_at,
        body_digest: hash(v.body ?? ""),
        actor_id: v.user?.id,
      });
    }
    const lists = [];
    let discussionCount = 0;
    const numbers = new Set([
      ...first.issues.map((i) => i.number),
      ...first.prs.map((i) => i.number),
    ]);
    for (const number of numbers) {
      const path = base + "/issues/" + number + "/comments",
        rows = await client.list(path, p.limits.discussion_items);
      lists.push({ path, rows });
      for (const row of rows) {
        discussionCount++;
        if (discussionCount > p.limits.discussion_items)
          fail("discussion_limit");
        const body = row.body ?? "";
        let machine = null;
        if (typeof body !== "string") fail("resource_invalid");
        if (body.startsWith("<!-- ai-workflow:github:v1 -->\n")) {
          try {
            const parsed = JSON.parse(
              body.slice("<!-- ai-workflow:github:v1 -->\n".length),
            );
            if (
              row.user?.type === "Bot" &&
              validate("machine", parsed).valid &&
              parsed.repository_id === p.repository_id &&
              parsed.issue_number === number
            )
              machine = parsed;
            else result.unresolved.push("machine_record_invalid");
          } catch {
            result.unresolved.push("machine_record_invalid");
          }
        }
        if (
          !machine &&
          !p.manual_mappings.some(
            (m) =>
              m.id === row.id &&
              m.body_digest === hash(body) &&
              ["not_claim", "released_claim"].includes(m.disposition),
          )
        )
          result.unresolved.push("manual_record_unknown");
        result.sources.push({
          kind: "comment",
          id: row.id,
          issue_number: number,
          actor_id: row.user?.id,
          actor_type: row.user?.type,
          updated_at: row.updated_at,
          body_digest: hash(body),
          state: "active",
          machine,
        });
      }
    }
    result.sections.comments = "complete";
    for (const pr of first.prs) {
      const path = base + "/pulls/" + pr.number + "/reviews",
        rows = await client.list(path, p.limits.discussion_items);
      lists.push({ path, rows });
      for (const row of rows) {
        if (++discussionCount > p.limits.discussion_items)
          fail("discussion_limit");
        if (!nowValid(row.submitted_at)) {
          result.unresolved.push("review_time_unknown");
          continue;
        }
        result.sources.push({
          kind: "review",
          id: row.id,
          issue_number: pr.number,
          actor_id: row.user?.id,
          actor_type: row.user?.type,
          updated_at: row.submitted_at,
          body_digest: hash(row.body ?? ""),
          state:
            row.state === "DISMISSED"
              ? "dismissed"
              : row.state === "APPROVED"
                ? "active"
                : "pending",
          machine: null,
        });
      }
    }
    result.sections.reviews = "complete";
    const sourceIds = new Set();
    for (const row of result.sources) {
      const key = row.kind + "|" + row.id;
      if (sourceIds.has(key)) fail("duplicate_resource");
      sourceIds.add(key);
    }
    for (const ref of scope.approval_sources)
      if (
        !ref ||
        !result.sources.some(
          (s) =>
            s.kind === ref.kind &&
            s.id === ref.id &&
            s.issue_number === ref.issue_number,
        )
      )
        fail("approval_source_missing");
    if (scope.actors.length) {
      const actorIds = new Set();
      for (const actor of scope.actors) {
        if (
          !actor ||
          Object.keys(actor).some((k) => !["login", "id"].includes(k)) ||
          typeof actor.login !== "string" ||
          !/^[A-Za-z0-9-]{1,100}$/.test(actor.login) ||
          !Number.isSafeInteger(actor.id) ||
          actor.id < 1 ||
          actorIds.has(actor.id)
        )
          fail("actor_invalid");
        actorIds.add(actor.id);
        const r = await client.request(
          "GET",
          base + "/collaborators/" + actor.login + "/permission",
        );
        if (
          r.status !== 200 ||
          r.body.user?.id !== actor.id ||
          r.body.user?.login !== actor.login
        )
          fail("permission_unknown");
        result.permissions.push({
          actor_id: actor.id,
          login: actor.login,
          permission: r.body.permission,
          observed_at: clock(),
        });
      }
      result.sections.permissions = "complete";
    } else result.unresolved.push("permission_unknown");
    if (scope.include_protections) {
      result.protections = await collectProtections(p, client, clock, (code) =>
        result.unresolved.push(code),
      );
      result.sections.protections = result.protections.every(
        (x) => x.enforced === true && Array.isArray(x.bypass_actors),
      )
        ? "complete"
        : "unknown";
      if (result.sections.protections !== "complete")
        result.unresolved.push("protection_unknown");
    } else result.unresolved.push("protection_unknown");
    // Repeat every list, not just a count, to detect changes during the traversal.
    for (const { path, rows } of lists)
      if (!same(rows, await client.list(path, p.limits.discussion_items)))
        fail("concurrent_change");
    for (const kind of ["issues", "prs", "branches"]) {
      if (!same(first[kind], await client.list(paths[kind])))
        fail("concurrent_change");
      result.sections[kind] = "complete";
    }
    for (const issue of result.issues) {
      const r = await client.request("GET", base + "/issues/" + issue.number);
      if (
        r.status !== 200 ||
        contractDigest({ ...r.body, body: r.body.body ?? "" }) !==
          issue.contract_digest ||
        r.body.updated_at !== issue.updated_at
      )
        fail("concurrent_change");
    }
    result.finished_at = clock();
    result.unresolved = [...new Set(result.unresolved)];
    result.status = "complete";
    if (Buffer.byteLength(JSON.stringify(result)) > 1048576)
      fail("output_limit");
    if (!validate("snapshot", result).valid) fail("snapshot_invalid");
    return result;
  } catch (error) {
    result.finished_at = nowValid(clock()) ? clock() : result.started_at;
    result.unresolved = [
      ...new Set([...result.unresolved, errorCode(error, "collection_failed")]),
    ].slice(0, 1000);
    if (result.status === "complete") result.status = "partial";
    if (Buffer.byteLength(JSON.stringify(result)) > 1048576) {
      for (const key of [
        "issues",
        "prs",
        "branches",
        "sources",
        "permissions",
        "protections",
        "pages",
      ])
        result[key] = [];
      result.sections = Object.fromEntries(
        SECTIONS.map((key) => [key, "unknown"]),
      );
      result.unresolved = ["output_limit"];
    }
    return result;
  }
}
