import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  writeFileSync,
  writeSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  lstatSync,
  realpathSync,
  chmodSync,
  unlinkSync,
} from "node:fs";
import { join, resolve, relative, sep, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  planIntegration,
  validateIntegrationArtifact as valid,
  summarizeIntegration,
  hash,
  same,
  safe,
  fail,
  errorCode,
  reference,
} from "./core.mjs";
import { inspectIntegrationAuthorization } from "../workflow-github/auth.mjs";
import { executeIntegrationSummaryOperation } from "../workflow-github/broker.mjs";
import {
  docker,
  dockerArgs,
  inspectContainer,
  stopContainer,
} from "../workflow-runner/adapter.mjs";

const authorities = new WeakMap(),
  executors = new WeakMap(),
  permits = new WeakMap();
const bytesHash = (b) => createHash("sha256").update(b).digest("hex");
function freezeJson(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}
const bounded = async (fn, signal, ms = 10000) => {
  let timer, onAbort;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("port_timeout")), ms);
        onAbort = () => reject(new Error("stopped"));
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
};
const below = (parent, child) => {
  const r = relative(parent, child);
  return (
    r === "" || (!r.startsWith(".." + sep) && r !== ".." && !r.startsWith(sep))
  );
};
function privateDirectory(path) {
  const root = realpathSync(path);
  if (
    root !== resolve(path) ||
    !lstatSync(root).isDirectory() ||
    lstatSync(root).mode & 0o077
  )
    fail("storage_invalid");
  return root;
}
function readRegular(path, max) {
  let fd;
  try {
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const s = fstatSync(fd);
    if (!s.isFile() || s.nlink !== 1 || s.size > max) fail("file_invalid");
    return readFileSync(fd);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function writeProtected(path, data) {
  let fd;
  try {
    fd = openSync(path, "wx", 0o600);
    writeFileSync(fd, data);
    fsyncSync(fd);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  const d = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    fsyncSync(d);
  } finally {
    closeSync(d);
  }
}

// These factories are host configuration APIs. Never expose them to worker RPC.
export function createIntegrationAuthority(options) {
  if (
    !options ||
    !["synthetic", "production"].includes(options.mode) ||
    typeof options.approveProfile !== "function" ||
    typeof options.authorize !== "function" ||
    typeof options.dispatcher?.revalidate !== "function" ||
    typeof options.dispatcher?.inspect !== "function" ||
    !Array.isArray(options.tasks) ||
    options.tasks.length > 10 ||
    options.tasks.some(
      (t) => !Number.isSafeInteger(t.issue_number) || !t.handle,
    ) ||
    new Set(options.tasks.map((t) => t.issue_number)).size !==
      options.tasks.length
  )
    fail("authority_invalid");
  if (options.mode === "production" && options.dispatcher.mode !== "production")
    fail("dispatcher_mode_invalid");
  const a = Object.freeze({});
  authorities.set(a, {
    ...options,
    tasks: options.tasks.map((t) => ({ ...t })),
  });
  return a;
}
export function createSyntheticIntegrationExecutor(ports) {
  if (
    !ports ||
    ["prepare", "verify", "stop"].some((k) => typeof ports[k] !== "function")
  )
    fail("executor_invalid");
  const e = Object.freeze({});
  executors.set(e, {
    ...ports,
    mode: "synthetic",
    cleanup: ports.cleanup ?? (async () => {}),
  });
  return e;
}

export async function openIntegrationController({
  directory,
  profile,
  request,
  authority,
  executor,
  clock = () => new Date().toISOString(),
  bundle,
  publisher,
}) {
  const a = authorities.get(authority),
    e = executors.get(executor),
    checked = planIntegration({ profile, request });
  if (
    !a ||
    !e ||
    checked.status !== "planned" ||
    typeof clock !== "function" ||
    (a.mode === "production" && e.mode !== "isolated")
  )
    fail("controller_invalid");
  const p = freezeJson(structuredClone(profile)),
    r = freezeJson(structuredClone(request)),
    plan = freezeJson(checked.plan),
    root = privateDirectory(directory),
    repo = realpathSync(new URL("../../", import.meta.url));
  if (below(repo, root) || below(root, repo)) fail("storage_invalid");
  const lock = join(root, "integration.lock"),
    fd = openSync(lock, "wx", 0o600);
  writeSync(
    fd,
    JSON.stringify({ pid: process.pid, plan_digest: plan.plan_digest }),
  );
  fsyncSync(fd);
  const runContext = JSON.stringify({
    schema_version: 1,
    artifact_kind: "integration-run-context",
    authority: false,
    profile: p,
    request: r,
    plan,
  });
  const contextBytes = Buffer.byteLength(runContext);
  try {
    if (
      contextBytes > p.limits.artifact_bytes ||
      contextBytes > p.limits.run_artifact_bytes
    )
      fail("artifact_limit");
    writeProtected(join(root, "integration-run.json"), runContext);
  } catch (err) {
    closeSync(fd);
    unlinkSync(lock);
    if (err.code === "EEXIST") fail("run_recovery_required");
    throw err;
  }
  let closed = false,
    busy = false,
    poisoned = false,
    stopped = false,
    last = null,
    totalBytes = contextBytes,
    guardCalls = 0;
  const reportIds = new Map();
  const abort = new AbortController(),
    started = performance.now();
  const timeValid = () => {
    const at = clock();
    if (typeof at !== "string" || !Number.isFinite(Date.parse(at)))
      fail("time_invalid");
    return at;
  };
  async function guard() {
    if (++guardCalls > 400) fail("observation_limit");
    if (closed || poisoned) fail("controller_unavailable");
    if (stopped || abort.signal.aborted) fail("stopped");
    const now = timeValid();
    if (
      performance.now() - started > p.limits.run_seconds * 1000 ||
      Date.parse(now) < Date.parse(p.reviewed_at) ||
      Date.parse(now) >= Date.parse(p.expires_at)
    )
      fail("expired");
    const binding_digest = hash({ profile: p, request: r }),
      approval = await bounded(
        () =>
          a.approveProfile({
            binding_digest,
            profile: structuredClone(p),
            request: structuredClone(r),
            signal: abort.signal,
          }),
        abort.signal,
      );
    if (
      !safe(approval) ||
      Object.keys(approval).sort().join() !==
        "approved,binding_digest,expires_at,observed_at,owner_id" ||
      approval.approved !== true ||
      approval.binding_digest !== binding_digest ||
      approval.owner_id !== p.owner_id ||
      !Number.isFinite(Date.parse(approval.expires_at)) ||
      Date.parse(approval.expires_at) <= Date.parse(now) ||
      !Number.isFinite(Date.parse(approval.observed_at)) ||
      Date.parse(approval.observed_at) > Date.parse(now) ||
      Date.parse(now) - Date.parse(approval.observed_at) > 60000
    )
      fail("profile_approval_invalid");
    const contexts = [];
    for (const target of plan.targets) {
      const task = a.tasks.find((t) => t.issue_number === target.issue_number);
      if (!task) fail("task_missing");
      const current = await bounded(
        () => a.dispatcher.revalidate(task.handle),
        abort.signal,
      );
      if (current?.status !== "passed") fail("authority_revoked");
      const context = await bounded(
        () =>
          a.authorize({
            issue_number: target.issue_number,
            run_id: plan.run_id,
            signal: abort.signal,
          }),
        abort.signal,
      );
      let d;
      try {
        d = await bounded(
          () =>
            inspectIntegrationAuthorization(
              context.capability,
              context.provider,
              context.journal,
            ),
          abort.signal,
        );
      } catch (err) {
        if (errorCode(err, "") === "observation_mismatch") fail("stale");
        throw err;
      }
      const { input, observed } = d,
        t = input.grant.selected.find(
          (t) => t.issue_number === target.issue_number,
        ),
        pr = input.snapshot.prs.find((x) => x.number === target.pr_number),
        base = input.snapshot.branches.find((b) => b.name === p.base_branch),
        x = observed.execution;
      const ledger = await bounded(() => a.dispatcher.inspect(), abort.signal),
        claim = ledger.claims?.find((c) => c.claim_id === x.claim_id);
      if (
        !claim ||
        ledger.status !== "ready" ||
        ledger.generation !== x.generation ||
        claim.generation !== x.generation ||
        claim.worker_id !== x.worker_id ||
        claim.issue_number !== target.issue_number ||
        claim.run_id !== plan.run_id ||
        claim.head_sha !== target.head_sha ||
        !["ready", "running", "publishing"].includes(claim.status)
      )
        fail("claim_binding_invalid");
      if (
        (a.mode === "production" &&
          (d.authority_mode !== "production" ||
            input.policy.mode !== "production")) ||
        input.policy.repository !== p.repository ||
        input.policy.repository_id !== p.repository_id ||
        input.policy.owner.id !== p.owner_id ||
        !same(input.policy.profile, p.execution_profile) ||
        input.grant.run_id !== plan.run_id ||
        !t ||
        t.head_sha !== target.head_sha ||
        t.plan.digest !== target.plan_digest ||
        !t.stages.includes("validation") ||
        x.expected_head !== target.head_sha ||
        !x.branch.startsWith(
          input.policy.branch_prefix + target.issue_number + "/",
        )
      )
        fail("authority_binding_invalid");
      if (
        !pr ||
        pr.state !== "open" ||
        pr.merged ||
        pr.head_repository_id !== p.repository_id ||
        pr.head_branch !== x.branch ||
        pr.base_branch !== p.base_branch ||
        pr.head_sha !== target.head_sha ||
        base?.sha !== plan.main_sha
      )
        fail("stale");
      contexts.push({ target, context, data: d });
    }
    return contexts;
  }
  function keep(data, kind = "source") {
    const text = JSON.stringify(data),
      bytes = Buffer.byteLength(text);
    if (
      bytes > p.limits.artifact_bytes ||
      totalBytes + bytes > p.limits.run_artifact_bytes
    )
      fail("artifact_limit");
    const digest = hash(data),
      id = "integration-" + digest,
      path = join(root, id + ".json");
    try {
      writeProtected(path, text);
      totalBytes += bytes;
    } catch (err) {
      if (
        err.code !== "EEXIST" ||
        !same(JSON.parse(readRegular(path, p.limits.artifact_bytes)), data)
      )
        throw err;
    }
    return reference(kind, id, digest);
  }
  function store(result) {
    if (
      !valid("result", result).valid ||
      Buffer.byteLength(JSON.stringify(result)) > 1048576
    )
      fail("result_invalid");
    const artifact_ref = keep(result, "integration-result");
    last = { ...result, artifact_ref };
    return structuredClone(last);
  }
  const initial = () => ({
    schema_version: 1,
    artifact_kind: "integration-result",
    authority: false,
    run_id: plan.run_id,
    plan: structuredClone(plan),
    status: "not_evaluated",
    mode: a.mode === "production" ? "production" : "synthetic",
    started_at: timeValid(),
    finished_at: timeValid(),
    cases: [],
    repairs: [],
    diagnostics: [],
    not_evaluated: [
      "all_subsets_and_orders",
      "human_merge_approval",
      ...(a.mode === "synthetic" ? ["real_human_identity", "live_github"] : []),
      ...(e.mode === "synthetic" ? ["external_worker_isolation"] : []),
    ],
  });
  async function stop() {
    stopped = true;
    abort.abort();
    try {
      return await bounded(
        () => e.stop(),
        null,
        Math.min(p.limits.cleanup_seconds * 1000, 10000),
      );
    } catch {
      poisoned = true;
      return { stopped: false };
    }
  }
  async function recheck() {
    try {
      await guard();
      return { status: "passed", authority: false };
    } catch (err) {
      const code = errorCode(err, "authority_unknown");
      if (last) {
        const { artifact_ref, ...content } = last;
        store({
          ...content,
          status: code === "stale" ? "stale" : "blocked",
          finished_at: timeValid(),
          diagnostics: [{ code }],
        });
      }
      return { status: "blocked", authority: false, diagnostics: [{ code }] };
    }
  }
  return Object.freeze({
    async run() {
      if (busy)
        return {
          status: "blocked",
          authority: false,
          diagnostics: [{ code: "controller_busy" }],
        };
      if (last) {
        await recheck();
        return structuredClone(last);
      }
      busy = true;
      const result = initial();
      let timer;
      try {
        if (stopped) {
          result.status = "stopped";
          return store(result);
        }
        timer = setTimeout(() => {
          stopped = true;
          abort.abort();
        }, p.limits.run_seconds * 1000);
        store(result);
        await guard();
        let count = 0;
        for (const c of plan.cases) {
          await guard();
          let prepared,
            logBytes = 0;
          const item = {
            ...structuredClone(c),
            git_status: "not_evaluated",
            checks: [],
            log_refs: [],
          };
          result.cases.push(item);
          store(result);
          try {
            prepared = await bounded(
              () =>
                e.prepare({
                  plan,
                  profile: p,
                  case: c,
                  bundle,
                  signal: abort.signal,
                }),
              abort.signal,
              p.limits.command_seconds * 1000,
            );
            if (
              !prepared ||
              !["passed", "conflict", "error"].includes(prepared.status)
            )
              fail("prepare_unknown");
            item.git_status = prepared.status;
            if (prepared.status === "passed") {
              for (const k of ["tree_sha", "commit_sha", "source_digest"]) {
                if (
                  !(
                    k === "source_digest" ? /^[a-f0-9]{64}$/ : /^[a-f0-9]{40}$/
                  ).test(prepared[k] ?? "")
                )
                  fail("prepare_unknown");
                item[k] = prepared[k];
              }
              store(result);
              for (const check of p.checks) {
                await guard();
                if (++count > p.limits.max_commands) fail("command_limit");
                const v = await bounded(
                  () =>
                    e.verify({
                      plan,
                      profile: p,
                      case: c,
                      prepared,
                      check,
                      signal: abort.signal,
                    }),
                  abort.signal,
                  check.timeout_seconds * 1000,
                );
                if (
                  !safe(v) ||
                  !["passed", "failed", "not_evaluated", "error"].includes(
                    v.status,
                  ) ||
                  !Number.isInteger(v.exit_code) ||
                  v.exit_code < -1 ||
                  v.exit_code > 255 ||
                  !Number.isSafeInteger(v.test_count) ||
                  v.test_count < 0 ||
                  typeof v.stdout_base64 !== "string" ||
                  typeof v.stderr_base64 !== "string"
                )
                  fail("verification_unknown");
                const raw = {
                    check_id: check.id,
                    stdout_base64: v.stdout_base64,
                    stderr_base64: v.stderr_base64,
                  },
                  size = Buffer.byteLength(JSON.stringify(raw));
                logBytes += size;
                if (logBytes > p.limits.log_bytes) fail("log_limit");
                item.log_refs.push(keep(raw));
                const status =
                  v.status === "passed" &&
                  (v.exit_code !== 0 || v.test_count < check.minimum_tests)
                    ? "not_evaluated"
                    : v.status;
                item.checks.push({
                  check_id: check.id,
                  category: check.category,
                  status,
                  exit_code: v.exit_code,
                  test_count: v.test_count,
                  ac_refs: [...check.ac_refs],
                });
                result.finished_at = timeValid();
                store(result);
                await guard();
              }
            }
          } finally {
            if (prepared)
              await bounded(
                () => e.cleanup(prepared),
                null,
                Math.min(p.limits.cleanup_seconds * 1000, 10000),
              );
          }
          item.log_refs.push(
            keep({
              case_id: c.case_id,
              git_status: item.git_status,
              tree_sha: item.tree_sha ?? null,
              commit_sha: item.commit_sha ?? null,
              source_digest: item.source_digest ?? null,
            }),
          );
          if (
            item.git_status === "conflict" ||
            item.checks.some((c) => c.status === "failed")
          )
            result.repairs.push({
              case_id: c.case_id,
              issue_numbers: [...c.issue_numbers],
              ac_refs: [
                ...new Set(
                  (item.git_status === "conflict"
                    ? p.checks
                    : item.checks.filter((c) => c.status === "failed")
                  ).flatMap((c) => c.ac_refs),
                ),
              ],
              destination: "original_issue_branch",
              required_actions: [
                "fix_original_branch",
                "individual_verification",
                "ai_review",
                "integration_recheck",
                "human_review",
              ],
            });
        }
        const categories = new Set(p.checks.map((c) => c.category)),
          missing = p.required_categories.filter((c) => !categories.has(c));
        result.not_evaluated.push(...missing.map((c) => "category_" + c));
        result.status = result.cases.some(
          (c) =>
            c.git_status === "conflict" ||
            c.checks.some((c) => c.status === "failed"),
        )
          ? "failed"
          : result.cases.some(
                (c) =>
                  c.git_status === "error" ||
                  c.checks.some((c) => c.status === "error"),
              )
            ? "error"
            : missing.length ||
                result.cases.some(
                  (c) =>
                    c.git_status !== "passed" ||
                    c.checks.length !== p.checks.length ||
                    c.checks.some((c) => c.status !== "passed"),
                )
              ? "not_evaluated"
              : "passed";
        await guard();
      } catch (err) {
        const code = errorCode(err, "execution_unknown");
        abort.abort();
        result.status = stopped
          ? "stopped"
          : code === "stale"
            ? "stale"
            : "blocked";
        result.diagnostics.push({ code });
        const stoppedResult = await bounded(() => e.stop(), null, 10000).catch(
          () => ({ stopped: false }),
        );
        if (stoppedResult.stopped !== true) {
          poisoned = true;
          result.diagnostics.push({ code: "stop_unknown" });
        }
      } finally {
        busy = false;
        clearTimeout(timer);
      }
      result.finished_at = timeValid();
      return store(result);
    },
    recheck,
    stop,
    async report({
      issue_number = plan.targets[0].issue_number,
      operation_id = "integration-" + plan.plan_digest.slice(0, 32),
      publish = false,
    } = {}) {
      try {
        if (
          (!reportIds.has(operation_id) && reportIds.size >= 10) ||
          (reportIds.has(operation_id) &&
            reportIds.get(operation_id) !== issue_number)
        )
          fail("report_limit");
        if (
          !last ||
          busy ||
          last.status === "stale" ||
          ["stopped", "blocked"].includes(last.status)
        )
          fail("report_unavailable");
        const contexts = await guard(),
          row = contexts.find((c) => c.target.issue_number === issue_number);
        if (!row) fail("report_target_invalid");
        const content = JSON.parse(
          readRegular(
            join(root, last.artifact_ref.id + ".json"),
            p.limits.artifact_bytes,
          ),
        );
        if (
          hash(content) !== last.artifact_ref.digest ||
          !same({ ...content, artifact_ref: last.artifact_ref }, last)
        )
          fail("artifact_binding_invalid");
        const summary = summarizeIntegration(last);
        if (Buffer.byteLength(summary) > p.limits.summary_bytes)
          fail("summary_limit");
        const d = row.data,
          x = d.observed.execution,
          operation = {
            schema_version: 2,
            artifact_kind: "github-operation",
            operation_id,
            kind: "append_record",
            repository: p.repository,
            repository_id: p.repository_id,
            issue_number,
            run_id: plan.run_id,
            claim_id: x.claim_id,
            worker_id: x.worker_id,
            generation: x.generation,
            branch: x.branch,
            expected_head: row.target.head_sha,
            policy_digest: hash(d.input.policy),
            grant_digest: hash(d.input.grant),
            stage: "validation",
            payload: {
              record_kind: "integration-report",
              result_digest: hash(last),
              summary_digest: hash(summary),
            },
          };
        const permit = Object.freeze({});
        permits.set(permit, {
          operation: structuredClone(operation),
          summary,
          result: structuredClone(last),
          check: recheck,
          mode: a.mode,
        });
        reportIds.set(operation_id, issue_number);
        if (!publish)
          return { status: "ready", authority: false, operation, permit };
        if (!publisher) fail("publisher_unavailable");
        return executeIntegrationSummaryOperation(
          operation,
          row.context.capability,
          {
            ...publisher,
            authorityProvider: row.context.provider,
            journal: row.context.journal,
            permit,
          },
        );
      } catch (err) {
        return {
          status: "blocked",
          authority: false,
          diagnostics: [{ code: errorCode(err, "report_unknown") }],
        };
      }
    },
    close() {
      if (closed) return;
      if (busy) {
        stopped = true;
        abort.abort();
        fail("controller_busy");
      }
      closed = true;
      abort.abort();
      closeSync(fd);
      unlinkSync(lock);
    },
  });
}
// Only permits minted from a persisted controller result can cross into P3.
export async function inspectIntegrationPublicationPermit(
  permit,
  operation,
  { reconcile = false } = {},
) {
  const p = permits.get(permit);
  if (!p || !safe(operation) || !same(p.operation, operation))
    fail("publication_permit_invalid");
  if (!reconcile && (await p.check()).status !== "passed")
    fail("publication_stale");
  return {
    summary: p.summary,
    result: structuredClone(p.result),
    mode: p.mode,
  };
}

export function createDockerIntegrationExecutor({ image }) {
  if (typeof image !== "string" || !/^sha256:[a-f0-9]{64}$/.test(image))
    fail("image_invalid");
  const live = new Map(),
    sources = new WeakMap();
  let poisoned = false;
  async function container(mode, work, profile, input, signal, maxBytes) {
    if (live.size) fail("executor_busy");
    if (poisoned || profile.image !== image || signal?.aborted)
      fail("executor_unavailable");
    const attempt_id = "integration-" + randomUUID(),
      gateway = mkdtempSync(join(tmpdir(), "integration-empty-"));
    const args = dockerArgs({
      attempt_id,
      role: "verification",
      profile: { image, limits: profile.limits, write_paths: [] },
      workspace: { source: work, mounts: [] },
      socket_directory: gateway,
    });
    live.set(attempt_id, null);
    let id;
    try {
      id = (await docker([...args, mode], { signal })).trim();
      live.set(attempt_id, id);
      const c = await inspectContainer(id, attempt_id),
        h = c.HostConfig;
      if (
        c.Image !== image ||
        h.Memory !== profile.limits.memory_mib * 1048576 ||
        h.MemorySwap !== h.Memory ||
        h.NanoCpus !== profile.limits.cpus * 1000000000 ||
        h.PidsLimit !== profile.limits.pids ||
        c.Mounts.some(
          (m) =>
            m.Type === "bind" &&
            (m.RW || !["/work", "/gateway"].includes(m.Destination)),
        ) ||
        Object.keys(h.Tmpfs ?? {})
          .sort()
          .join() !== "/scratch,/tmp" ||
        c.Config.Env.some((s) =>
          /^(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy)=.+/.test(
            s,
          ),
        )
      )
        fail("isolation_invalid");
      const text = await docker(["start", "--attach", "--interactive", id], {
        input: JSON.stringify(input),
        signal,
        maxBytes,
        timeout: Math.min(profile.limits.command_seconds, 1800) * 1000,
      });
      const stopped = await stopContainer(id, attempt_id);
      if (!stopped.stopped || stopped.exit_code !== 0)
        fail("executor_exit_unknown");
      return JSON.parse(text);
    } finally {
      try {
        if (!id) {
          const rows = JSON.parse(
            await docker(["inspect", "runner-" + attempt_id]),
          );
          if (rows[0]?.Config?.Labels?.["ai-workflow-runner"] !== attempt_id)
            fail("container_binding_invalid");
          id = rows[0].Id;
        }
        await stopContainer(id, attempt_id);
        await docker(["rm", id]);
        live.delete(attempt_id);
        rmSync(gateway, { recursive: true, force: true });
      } catch {
        poisoned = true;
      }
      if (poisoned) fail("cleanup_unknown");
    }
  }
  const adapter = {
    async prepare(q) {
      if (
        !valid("profile", q.profile).valid ||
        !valid("plan", q.plan).valid ||
        hash(q.profile) !== q.plan.profile_digest ||
        !q.bundle ||
        q.bundle.digest !== q.plan.bundle_digest ||
        q.profile.image !== image
      )
        fail("bundle_invalid");
      const bytes = readRegular(q.bundle.path, q.profile.limits.bundle_bytes);
      if (bytesHash(bytes) !== q.bundle.digest) fail("bundle_digest_invalid");
      const root = mkdtempSync(join(tmpdir(), "integration-source-")),
        work = join(root, "input"),
        source = join(root, "source");
      mkdirSync(work, { mode: 0o755 });
      mkdirSync(source, { mode: 0o755 });
      let handed = false;
      try {
        writeFileSync(join(work, "source.bundle"), bytes, {
          mode: 0o444,
          flag: "wx",
        });
        const heads = q.case.issue_numbers.map((id) => {
          const t = q.plan.targets.find((t) => t.issue_number === id);
          if (!t) fail("case_invalid");
          return t.head_sha;
        });
        const value = await container(
          "integration-prepare",
          work,
          q.profile,
          { main_sha: q.plan.main_sha, heads, limits: q.profile.limits },
          q.signal,
          Math.ceil(q.profile.limits.source_bytes * 1.4) + 10 * 1048576,
        );
        if (!value || !["passed", "conflict", "error"].includes(value.status))
          fail("prepare_unknown");
        if (value.status === "error") return { status: "error" };
        const b = value.boundary,
          l = q.profile.limits,
          cpu = b?.cpu?.split(" ").map(Number);
        if (
          b?.uid !== 1000 ||
          Number(b.memory) !== l.memory_mib * 1048576 ||
          Number(b.pids) !== l.pids ||
          !cpu ||
          cpu[0] / cpu[1] !== l.cpus ||
          b.scratch_bytes + b.tmp_bytes > l.scratch_mib * 1048576 ||
          b.scratch_bytes <= 0 ||
          b.tmp_bytes <= 0
        )
          fail("resource_limits_unverified");
        if (value.status === "conflict") return { status: "conflict" };
        if (
          !Array.isArray(value.files) ||
          !value.files.length ||
          value.files.length > l.source_files ||
          !/^git version [0-9.]+/.test(value.git_version)
        )
          fail("source_invalid");
        const listing = [],
          paths = new Set();
        let total = 0;
        for (const f of value.files) {
          if (
            !f ||
            Object.keys(f).sort().join() !==
              "content_base64,digest,mode,path" ||
            typeof f.path !== "string" ||
            !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(f.path) ||
            f.path
              .split("/")
              .some((x) => [".", "..", ".git", ".gitmodules"].includes(x)) ||
            !["100644", "100755"].includes(f.mode) ||
            paths.has(f.path) ||
            typeof f.content_base64 !== "string" ||
            f.content_base64.length > Math.ceil(l.file_bytes / 3) * 4
          )
            fail("source_invalid");
          const data = Buffer.from(f.content_base64, "base64");
          total += data.length;
          if (
            data.toString("base64") !== f.content_base64 ||
            data.length > l.file_bytes ||
            total > l.source_bytes ||
            bytesHash(data) !== f.digest
          )
            fail("source_limit");
          paths.add(f.path);
          const path = join(source, f.path);
          mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
          writeFileSync(path, data, {
            mode: f.mode === "100755" ? 0o555 : 0o444,
            flag: "wx",
          });
          listing.push({ path: f.path, mode: f.mode, digest: f.digest });
        }
        const prepared = Object.freeze({
          status: "passed",
          tree_sha: value.tree_sha,
          commit_sha: value.commit_sha,
          source_digest: hash(listing),
        });
        sources.set(prepared, {
          root,
          source,
          plan_digest: q.plan.plan_digest,
          case_id: q.case.case_id,
        });
        handed = true;
        return prepared;
      } finally {
        if (!handed) rmSync(root, { recursive: true, force: true });
      }
    },
    async verify(q) {
      const source = sources.get(q.prepared);
      if (
        !source ||
        !valid("profile", q.profile).valid ||
        hash(q.profile) !== q.plan.profile_digest ||
        source.plan_digest !== q.plan.plan_digest ||
        source.case_id !== q.case.case_id ||
        !q.profile.checks.some((c) => same(c, q.check))
      )
        fail("source_handle_invalid");
      const v = await container(
        "verify",
        source.source,
        q.profile,
        { executable: q.check.executable, argv: q.check.argv },
        q.signal,
        1048576,
      );
      if (
        !safe(v) ||
        !same(v.command, {
          executable: q.check.executable,
          argv: q.check.argv,
        }) ||
        !Number.isInteger(v.exit_code) ||
        !Number.isSafeInteger(v.test_count) ||
        typeof v.stdout_base64 !== "string" ||
        typeof v.stderr_base64 !== "string"
      )
        fail("verification_unknown");
      for (const name of ["stdout", "stderr"]) {
        const data = Buffer.from(v[name + "_base64"], "base64");
        if (
          data.toString("base64") !== v[name + "_base64"] ||
          data.length > 512 * 1024 ||
          bytesHash(data) !== v[name + "_digest"]
        )
          fail("verification_unknown");
      }
      return {
        status: v.limited
          ? "error"
          : v.exit_code === 0
            ? v.test_count >= q.check.minimum_tests
              ? "passed"
              : "not_evaluated"
            : "failed",
        exit_code: v.exit_code,
        test_count: v.test_count,
        stdout_base64: v.stdout_base64,
        stderr_base64: v.stderr_base64,
      };
    },
    async cleanup(prepared) {
      const s = sources.get(prepared);
      if (s) {
        rmSync(s.root, { recursive: true, force: true });
        sources.delete(prepared);
      }
    },
    async stop() {
      for (const [attempt, id] of live) {
        if (!id) {
          poisoned = true;
          return { stopped: false };
        }
        await stopContainer(id, attempt);
        await docker(["rm", id]);
        live.delete(attempt);
      }
      return { stopped: !poisoned };
    },
  };
  const e = Object.freeze(adapter);
  executors.set(e, { ...adapter, mode: "isolated" });
  return e;
}
