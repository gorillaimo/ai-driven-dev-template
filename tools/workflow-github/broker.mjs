import { inspectCapability } from "./auth.mjs";
import { validateGitHubArtifact as validate } from "./schema.mjs";
import { createClient } from "./client.mjs";
import { buildGitObjects } from "./git.mjs";
import {
  badJson,
  hash,
  same,
  fail,
  errorCode,
  safePath,
  MAX,
} from "./core.mjs";
const busy = new WeakSet();
const refusal = (code) => ({ status: "failed", diagnostics: [{ code }] });
function bind(operation, data) {
  const { policy: p, grant: g } = data.input,
    x = data.observed.execution,
    target = g.selected.find((t) => t.issue_number === operation.issue_number);
  if (
    !target ||
    operation.repository !== p.repository ||
    operation.repository_id !== p.repository_id ||
    operation.policy_digest !== hash(p) ||
    operation.grant_digest !== hash(g) ||
    operation.run_id !== g.run_id ||
    operation.claim_id !== x.claim_id ||
    operation.worker_id !== x.worker_id ||
    operation.generation !== x.generation ||
    operation.branch !== x.branch ||
    operation.expected_head !== x.expected_head ||
    operation.expected_head !== target.head_sha ||
    !safePath(operation.branch) ||
    !operation.branch.startsWith(
      p.branch_prefix + operation.issue_number + "/",
    ) ||
    p.protected_branches.includes(operation.branch) ||
    operation.branch === p.base_branch ||
    !p.allowed_operations.includes(operation.kind ?? operation.operation_kind)
  )
    fail("operation_binding_invalid");
  if (operation.stage && !target.stages.includes(operation.stage))
    fail("operation_stage_invalid");
  return target;
}
function newReceipt(o, now) {
  return {
    schema_version: 1,
    artifact_kind: "github-receipt",
    operation_id: o.operation_id,
    operation_kind: o.kind,
    repository: o.repository,
    repository_id: o.repository_id,
    issue_number: o.issue_number,
    run_id: o.run_id,
    claim_id: o.claim_id,
    worker_id: o.worker_id,
    generation: o.generation,
    branch: o.branch,
    expected_head: o.expected_head,
    policy_digest: o.policy_digest,
    grant_digest: o.grant_digest,
    input_digest: hash(o),
    status: "prepared",
    recorded_at: now,
    step: 0,
    request_count: 0,
    confirmed_steps: 0,
    expected: { kind: "branch", terminal: true },
    observed: {},
    diagnostics: [],
    partial: false,
  };
}
function machineBody(o) {
  const value = {
    version: 1,
    operation_id: o.operation_id,
    kind: o.kind,
    run_id: o.run_id,
    claim_id: o.claim_id,
    worker_id: o.worker_id,
    generation: o.generation,
    repository_id: o.repository_id,
    issue_number: o.issue_number,
    input_digest: hash(o),
    status: "confirmed",
    record_kind: o.payload.record_kind ?? "report",
    record_status: o.payload.status ?? "in_progress",
  };
  return "<!-- ai-workflow:github:v1 -->\n" + JSON.stringify(value);
}
async function checkTransport(transport, data) {
  if (
    data.input.policy.mode === "production" &&
    (transport?.kind !== "github_app" ||
      typeof transport.identity !== "function" ||
      !same(await transport.identity(), data.observed.credential))
  )
    fail("transport_identity_invalid");
  if (typeof transport?.request !== "function") fail("transport_unavailable");
}
async function readExpected(receipt, data, client) {
  const base = "/repos/" + receipt.repository,
    e = receipt.expected,
    actor = data.observed.credential.actor_id;
  if (e.kind === "branch" || e.kind === "ref") {
    const r = await client.request(
      "GET",
      base + "/git/ref/heads/" + receipt.branch,
    );
    if (
      r.status === 200 &&
      r.body.ref === "refs/heads/" + receipt.branch &&
      r.body.object?.sha === e.sha
    )
      return { sha: r.body.object.sha };
    return null;
  }
  if (e.kind === "comment") {
    const rows = await client.list(
      base + "/issues/" + receipt.issue_number + "/comments",
      data.input.policy.limits.discussion_items,
    );
    const matches = rows.filter(
      (v) =>
        v.user?.id === actor &&
        v.user?.type === "Bot" &&
        hash(v.body ?? "") === e.body_digest,
    );
    if (matches.length === 1)
      return { id: matches[0].id, body_digest: e.body_digest };
    return null;
  }
  if (e.kind === "pr") {
    const rows = await client.list(
      base +
        "/pulls?state=all&head=" +
        encodeURIComponent(
          receipt.repository.split("/")[0] + ":" + receipt.branch,
        ) +
        "&base=" +
        encodeURIComponent(e.base),
    );
    const matches = rows.filter(
      (v) =>
        v.user?.id === actor &&
        v.user?.type === "Bot" &&
        v.state === "open" &&
        v.draft === true &&
        v.head?.ref === e.head &&
        v.head?.sha === e.sha &&
        v.head?.repo?.id === receipt.repository_id &&
        v.base?.ref === e.base &&
        hash(v.body ?? "") === e.body_digest &&
        (e.number === undefined || v.number === e.number),
    );
    if (matches.length === 1)
      return {
        id: matches[0].id,
        number: matches[0].number,
        sha: e.sha,
        body_digest: e.body_digest,
      };
    return null;
  }
  // An immutable object may exist while later steps are still incomplete.
  // Its presence alone does not confirm the entire publish operation.
  return null;
}
async function reconcile(
  receipt,
  capability,
  { transport, journal, authorityProvider },
  signal,
) {
  const data = await inspectCapability(capability, authorityProvider, journal);
  bind(receipt, data);
  await checkTransport(transport, data);
  if (!validate("receipt", receipt).valid) fail("journal_record_invalid");
  const client = createClient(transport, {
    repository: receipt.repository,
    limits: data.input.policy.limits,
    clock: () => data.now,
    operation: true,
    signal,
  });
  client.charge(receipt.request_count + data.observed.api_requests);
  const observed = receipt.expected.terminal
    ? await readExpected(receipt, data, client)
    : null;
  const next = {
    ...receipt,
    status: observed ? "confirmed" : "unknown",
    recorded_at: data.now,
    request_count: Math.min(100, client.requestCount),
    observed: observed ?? receipt.observed,
    diagnostics: observed ? [] : [{ code: "operation_unresolved" }],
  };
  if (receipt.status === "confirmed") {
    if (!observed) fail("confirmed_state_changed");
    return next;
  }
  return journal.append(next);
}
export async function executeBrokerOperation(operation, capability, context) {
  let receipt,
    client,
    timer,
    owns = false;
  const controller = new AbortController();
  try {
    if (badJson(operation) || !validate("operation", operation).valid)
      fail("operation_invalid");
    if (!context?.journal || busy.has(context.journal)) fail("broker_busy");
    busy.add(context.journal);
    owns = true;
    timer = setTimeout(() => controller.abort(), MAX.operation_seconds * 1000);
    const { transport, journal, authorityProvider } = context;
    let data = await inspectCapability(capability, authorityProvider, journal);
    const target = bind(operation, data);
    await checkTransport(transport, data);
    if (controller.signal.aborted || journal.pending(operation.operation_id))
      fail("operation_unresolved");
    const previous = journal.latest(operation.operation_id);
    if (previous) {
      if (previous.input_digest !== hash(operation)) fail("operation_reused");
      return await reconcile(previous, capability, context, controller.signal);
    }
    const p = data.input.policy,
      base = "/repos/" + p.repository;
    client = createClient(transport, {
      repository: p.repository,
      limits: p.limits,
      clock: () => data.now,
      operation: true,
      signal: controller.signal,
    });
    client.charge(data.observed.api_requests);
    const branchPath = base + "/git/ref/heads/" + operation.branch,
      head = await client.request("GET", branchPath);
    if (operation.kind === "create_branch") {
      if (head.status !== 404) fail("branch_already_exists");
    } else if (
      head.status !== 200 ||
      head.body.ref !== "refs/heads/" + operation.branch ||
      head.body.object?.sha !== operation.expected_head
    )
      fail("head_mismatch");
    const steps = [];
    if (operation.kind === "create_branch")
      steps.push({
        method: "POST",
        path: base + "/git/refs",
        body: {
          ref: "refs/heads/" + operation.branch,
          sha: operation.expected_head,
        },
        expected: {
          kind: "branch",
          terminal: true,
          sha: operation.expected_head,
        },
      });
    if (operation.kind === "publish_commit") {
      const commit = await client.request(
        "GET",
        base + "/git/commits/" + operation.expected_head,
      );
      if (
        commit.status !== 200 ||
        commit.body.sha !== operation.expected_head ||
        !/^[a-f0-9]{40}$/.test(commit.body.tree?.sha ?? "")
      )
        fail("git_base_unknown");
      const tree = await client.request(
        "GET",
        base + "/git/trees/" + commit.body.tree.sha + "?recursive=1",
      );
      if (tree.status !== 200 || tree.body.sha !== commit.body.tree.sha)
        fail("git_base_unknown");
      if (
        Date.parse(operation.payload.created_at) > Date.parse(data.now) ||
        Date.parse(data.now) - Date.parse(operation.payload.created_at) >
          p.ttl_seconds * 1000
      )
        fail("git_time_invalid");
      const built = buildGitObjects({
        base: {
          sha: operation.expected_head,
          tree_sha: tree.body.sha,
          tree: tree.body.tree,
          truncated: tree.body.truncated,
        },
        changes: operation.payload.changes,
        operation_id: operation.operation_id,
        created_at: operation.payload.created_at,
        scope: {
          allowed_paths: target.allowed_paths,
          forbidden_paths: [...target.forbidden_paths, ...p.forbidden_paths],
        },
      });
      for (const object of built.objects)
        steps.push({
          method: "POST",
          path: base + "/git/" + object.kind,
          body: object.body,
          expected: {
            kind: "git-object",
            terminal: false,
            sha: object.sha,
            object_type: object.kind,
          },
        });
      steps.push({
        method: "PATCH",
        path: base + "/git/refs/heads/" + operation.branch,
        body: { sha: built.commit.sha, force: false },
        expected: { kind: "ref", terminal: true, sha: built.commit.sha },
      });
    }
    if (["append_claim", "append_record"].includes(operation.kind)) {
      const body = machineBody(operation);
      steps.push({
        method: "POST",
        path: base + "/issues/" + operation.issue_number + "/comments",
        body: { body },
        expected: {
          kind: "comment",
          terminal: true,
          body_digest: hash(body),
          marker: operation.operation_id,
        },
      });
    }
    if (["create_draft_pr", "update_draft_pr"].includes(operation.kind)) {
      if (
        operation.payload.title.trim() !== operation.payload.title ||
        /[\x00-\x1f\x7f]/.test(operation.payload.title)
      )
        fail("pr_input_invalid");
      const body =
          "Closes #" + operation.issue_number + "\n\n" + machineBody(operation),
        expected = {
          kind: "pr",
          terminal: true,
          head: operation.branch,
          base: p.base_branch,
          sha: operation.expected_head,
          body_digest: hash(body),
          marker: operation.operation_id,
        };
      if (operation.kind === "create_draft_pr") {
        const existing = await client.list(
          base +
            "/pulls?state=all&head=" +
            encodeURIComponent(
              p.repository.split("/")[0] + ":" + operation.branch,
            ) +
            "&base=" +
            encodeURIComponent(p.base_branch),
        );
        if (existing.length) fail("pr_already_exists");
        steps.push({
          method: "POST",
          path: base + "/pulls",
          body: {
            title: operation.payload.title,
            head: operation.branch,
            base: p.base_branch,
            body,
            draft: true,
            maintainer_can_modify: false,
          },
          expected,
        });
      } else {
        const existing = await client.request(
            "GET",
            base + "/pulls/" + operation.payload.pr_number,
          ),
          v = existing.body;
        if (
          existing.status !== 200 ||
          v.user?.id !== data.observed.credential.actor_id ||
          v.user?.type !== "Bot" ||
          v.draft !== true ||
          v.state !== "open" ||
          v.head?.ref !== operation.branch ||
          v.head?.sha !== operation.expected_head ||
          v.head?.repo?.id !== p.repository_id ||
          v.base?.ref !== p.base_branch
        )
          fail("pr_ownership_invalid");
        const known = journal
          .records()
          .some(
            (r) =>
              r.kind === "operation" &&
              r.receipt.status === "confirmed" &&
              r.receipt.expected.kind === "pr" &&
              r.receipt.observed.number === operation.payload.pr_number &&
              [
                "repository",
                "repository_id",
                "issue_number",
                "run_id",
                "claim_id",
                "worker_id",
                "generation",
                "branch",
              ].every((k) => r.receipt[k] === operation[k]),
          );
        if (!known) fail("pr_ownership_invalid");
        steps.push({
          method: "PATCH",
          path: base + "/pulls/" + operation.payload.pr_number,
          body: { title: operation.payload.title, body },
          expected: { ...expected, number: operation.payload.pr_number },
        });
      }
    }
    if (
      !steps.length ||
      steps.length + client.requestCount + 2 > p.limits.operation_requests
    )
      fail("operation_limit");
    receipt = newReceipt(operation, data.now);
    for (const [index, step] of steps.entries()) {
      data = await inspectCapability(capability, authorityProvider, journal, {
        phase: "mutation",
      });
      client.charge(data.observed.api_requests);
      bind(operation, data);
      await checkTransport(transport, data);
      if (controller.signal.aborted) fail("operation_stopped");
      // Ref updates always re-read the head immediately before the non-force update.
      if (step.method === "PATCH" && step.expected.kind === "ref") {
        const current = await client.request("GET", branchPath);
        if (
          current.status !== 200 ||
          current.body.object?.sha !== operation.expected_head
        )
          fail("head_mismatch");
      }
      receipt = {
        ...receipt,
        status: "prepared",
        recorded_at: data.now,
        step: index,
        request_count: client.requestCount,
        expected: step.expected,
        partial: index > 0,
      };
      journal.append(receipt);
      receipt = { ...receipt, status: "sending" };
      journal.append(receipt);
      const response = await client.request(step.method, step.path, step.body);
      if (
        response.status < 200 ||
        response.status >= 300 ||
        (step.expected.sha &&
          ["git-object", "branch", "ref"].includes(step.expected.kind) &&
          (response.body.sha ?? response.body.object?.sha) !==
            step.expected.sha)
      )
        fail("operation_response_invalid");
      receipt = {
        ...receipt,
        confirmed_steps: index + 1,
        request_count: client.requestCount,
        partial: true,
      };
    }
    const observed = await readExpected(receipt, data, client);
    if (!observed) fail("operation_readback_failed");
    receipt = {
      ...receipt,
      status: "confirmed",
      recorded_at: data.now,
      observed,
      request_count: client.requestCount,
      diagnostics: [],
      partial: false,
    };
    return journal.append(receipt);
  } catch (error) {
    const code = errorCode(error, "operation_failed");
    if (receipt) {
      const current = context.journal.latest(receipt.operation_id);
      if (
        current &&
        ["sending", "prepared", "unknown"].includes(current.status)
      ) {
        const next = {
          ...current,
          status: current.status === "prepared" ? "failed" : "unknown",
          request_count: Math.min(
            100,
            client?.requestCount ?? current.request_count,
          ),
          diagnostics: [{ code }],
          partial: current.status === "prepared" ? current.partial : true,
        };
        try {
          return context.journal.append(next);
        } catch {
          return { ...next, diagnostics: [{ code: "journal_unavailable" }] };
        }
      }
    }
    return refusal(code);
  } finally {
    clearTimeout(timer);
    if (owns) busy.delete(context.journal);
  }
}
export async function reconcileBrokerOperation(
  operationId,
  capability,
  context,
) {
  let owns = false;
  try {
    if (!/^[a-z0-9_-]{1,128}$/.test(operationId ?? ""))
      fail("operation_invalid");
    if (!context?.journal || busy.has(context.journal)) fail("broker_busy");
    busy.add(context.journal);
    owns = true;
    const receipt = context.journal.latest(operationId);
    if (!receipt) fail("operation_missing");
    return await reconcile(receipt, capability, context);
  } catch (error) {
    return {
      status: "unknown",
      diagnostics: [{ code: errorCode(error, "reconciliation_failed") }],
    };
  } finally {
    if (owns) busy.delete(context.journal);
  }
}
