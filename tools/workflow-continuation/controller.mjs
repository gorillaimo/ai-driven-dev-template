import {
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  writeSync,
  fstatSync,
  lstatSync,
  realpathSync,
  readdirSync,
  unlinkSync,
  constants,
} from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  badJson,
  hash,
  same,
  safePath,
  fail,
  errorCode,
} from "../workflow-github/core.mjs";
import { planBatch } from "../workflow-dispatch/plan.mjs";
const safe = (v) => !badJson(v),
  ajv = new Ajv({ strict: true, allErrors: false }),
  adapters = new WeakMap();
addFormats(ajv);
for (const [ns, kinds] of [
  ["issue", ["common"]],
  ["execution", ["common"]],
  ["continuation", ["profile", "request", "decision", "checkpoint", "report"]],
  ["autonomy", ["settings"]],
])
  for (const kind of kinds)
    ajv.addSchema(
      JSON.parse(
        readFileSync(
          new URL(
            `../../.ai-workflow/schemas/${ns}/v1/${kind}.schema.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
export function validateContinuationArtifact(kind, value) {
  return {
    valid:
      ["profile", "request", "decision", "checkpoint", "report"].includes(
        kind,
      ) &&
      safe(value) &&
      !!ajv.getSchema("urn:ai-workflow:continuation:v1:" + kind)(value),
  };
}

const budgetPolicyValid = ajv.getSchema("urn:ai-workflow:autonomy:v1:settings"),
  budgetTimeValid = ajv.compile({ type: "string", format: "date-time" });
const budgetReasons = [
  "budget_input_invalid", "budget_policy_invalid", "budget_clock_invalid",
  "budget_stopped", "budget_authority_lost", "budget_storage_failed", "budget_work_unknown",
  "budget_deadline", "budget_save_window", "budget_quota_critical", "budget_quota_low",
  "budget_quota_unknown", "budget_issue_limit", "budget_parallel_limit", "budget_agent_limit", "budget_repair_limit",
];
const budgetKeys = (v, keys) => v !== null && typeof v === "object" && !Array.isArray(v) &&
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const budgetInteger = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const budgetText = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max && v.trim().length > 0;
const budgetTime = v => budgetTimeValid(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;

// Advice for the supplied snapshot only: no IO, clock acquisition, grants, or run reset.
export function decideContinuationBudget(input) {
  const out = {
    schema_version: 1, artifact_kind: "autonomy-budget-decision", authority: false,
    decision: "checkpoint", reason_codes: [], held_issues: [],
    stop_new_at: null, deadline_at: null, remaining_percent: null,
    can_start_issue: false, can_start_agent: false, repairable_issues: [],
  };
  const invalid = code => ({ ...out, reason_codes: [code] });
  try {
    // Inspect descriptors/proxies before reading fields or serializing any input.
    if (!safe(input) || Buffer.byteLength(JSON.stringify(input), "utf8") > 16384 ||
      !budgetKeys(input, ["policy", "observation", "run", "now"])) return invalid("budget_input_invalid");
    const { policy: p, observation: o, run: r, now } = input;
    if (!budgetPolicyValid(p) || p.quota.checkpoint_remaining_percent >= p.quota.stop_new_remaining_percent ||
      p.limits.parallel_issues > p.limits.issues) return invalid("budget_policy_invalid");
    const flags = ["stop_requested", "authorization_lost", "storage_failed", "work_unknown"];
    if (!budgetKeys(r, ["started_at", "last_checked_at", "issues", "active_issues", "active_agents", ...flags]) ||
      flags.some(k => typeof r[k] !== "boolean") ||
      !Array.isArray(r.issues) || r.issues.length > 10 ||
      r.issues.some(v => !budgetKeys(v, ["number", "repair_rounds"]) ||
        !budgetInteger(v.number, 1, Number.MAX_SAFE_INTEGER) || !budgetInteger(v.repair_rounds, 0, 3)) ||
      new Set(r.issues.map(v => v.number)).size !== r.issues.length ||
      !Array.isArray(r.active_issues) || r.active_issues.length > 2 ||
      new Set(r.active_issues).size !== r.active_issues.length ||
      r.active_issues.some(n => !budgetInteger(n, 1, Number.MAX_SAFE_INTEGER) || !r.issues.some(v => v.number === n)) ||
      !budgetInteger(r.active_agents, 0, 3)) return invalid("budget_input_invalid");
    // Unknown fields are structural failures, not a supported-source outage.
    if (!o || typeof o !== "object" || Array.isArray(o) ||
      (o.status === "unsupported" ? !budgetKeys(o, ["status"]) :
        o.status === "unavailable" ? !budgetKeys(o, ["status", "retry_count"]) :
          o.status === "available" ? !budgetKeys(o, ["status", "retry_count", "observed_at", "expected_scope", "observed_scope", "windows", "warning", "exhausted"]) : true) ||
      (o.status !== "unsupported" && !budgetInteger(o.retry_count, 0, 1))) return invalid("budget_input_invalid");
    if (o.status === "available" && (
      !budgetKeys(o.expected_scope, ["account_ref", "workspace_ref", "window_ids"]) ||
      !budgetKeys(o.observed_scope, ["account_ref", "workspace_ref"]) ||
      !Array.isArray(o.windows) || o.windows.some(w => !budgetKeys(w, ["id", "metric", "value"])) ||
      typeof o.warning !== "boolean" || typeof o.exhausted !== "boolean")) return invalid("budget_input_invalid");
    const t = budgetTime(now), start = budgetTime(r.started_at), last = budgetTime(r.last_checked_at);
    if (t === null || start === null || last === null || start > last || last > t) return invalid("budget_clock_invalid");
    const deadline = start + p.limits.minutes * 60000, saveAt = deadline - 600000;
    const date = new Date(deadline);
    if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) return invalid("budget_clock_invalid");
    out.deadline_at = date.toISOString(); out.stop_new_at = new Date(saveAt).toISOString();
    const reasons = new Set(); let checkpoint = false, stopAllNew = false;
    const add = (code, stop = false) => { reasons.add(code); if (stop) checkpoint = true; };
    for (const [key, code] of [["stop_requested", "budget_stopped"], ["authorization_lost", "budget_authority_lost"],
      ["storage_failed", "budget_storage_failed"], ["work_unknown", "budget_work_unknown"]]) if (r[key]) add(code, true);
    if (t >= deadline) add("budget_deadline", true);
    if (t >= saveAt) { add("budget_save_window"); stopAllNew = true; }
    const quotaUnknown = () => { add("budget_quota_unknown", o.retry_count === 1); stopAllNew = true; };
    if (o.status === "unavailable") quotaUnknown();
    if (o.status === "available") {
      if (o.warning || o.exhausted) add("budget_quota_critical", true);
      const expected = o.expected_scope, actual = o.observed_scope, at = budgetTime(o.observed_at);
      const ids = expected.window_ids;
      const usable = [expected.account_ref, expected.workspace_ref, actual.account_ref, actual.workspace_ref].every(v => budgetText(v, 128)) &&
        expected.account_ref === actual.account_ref && expected.workspace_ref === actual.workspace_ref &&
        Array.isArray(ids) && ids.length >= 1 && ids.length <= 16 && ids.every(v => budgetText(v, 64)) && new Set(ids).size === ids.length &&
        o.windows.length === ids.length && new Set(o.windows.map(w => w.id)).size === o.windows.length &&
        o.windows.every(w => ids.includes(w.id) && ["used_percent", "remaining_percent"].includes(w.metric) &&
          typeof w.value === "number" && Number.isFinite(w.value) && w.value >= 0 && w.value <= 100) &&
        at !== null && at <= t && t - at <= 60000;
      if (!usable) quotaUnknown();
      else {
        out.remaining_percent = Math.min(...o.windows.map(w => w.metric === "used_percent" ? 100 - w.value : w.value));
        if (out.remaining_percent <= p.quota.checkpoint_remaining_percent) add("budget_quota_critical", true);
        if (out.remaining_percent <= p.quota.stop_new_remaining_percent) { add("budget_quota_low"); stopAllNew = true; }
      }
    }
    const issueFull = r.issues.length >= p.limits.issues,
      parallelFull = r.active_issues.length >= p.limits.parallel_issues,
      agentFull = r.active_agents >= 3;
    if (issueFull) add("budget_issue_limit");
    if (parallelFull) add("budget_parallel_limit", r.active_issues.length > p.limits.parallel_issues);
    if (agentFull) add("budget_agent_limit");
    out.held_issues = r.issues.filter(v => v.repair_rounds >= p.limits.repair_rounds).map(v => v.number).sort((a, b) => a - b);
    if (out.held_issues.length) add("budget_repair_limit");
    out.reason_codes = budgetReasons.filter(code => reasons.has(code));
    out.decision = checkpoint ? "checkpoint" : reasons.size ? "stop_new" : "continue";
    if (!checkpoint && !stopAllNew) {
      out.can_start_issue = !issueFull && !parallelFull;
      out.can_start_agent = !agentFull;
      out.repairable_issues = r.active_issues.filter(n => !out.held_issues.includes(n)).sort((a, b) => a - b);
    }
    return out;
  } catch {
    // Neither caller data nor raw exceptions belong in public budget diagnostics.
    return { schema_version: 1, artifact_kind: "autonomy-budget-decision", authority: false,
      decision: "checkpoint", reason_codes: ["budget_input_invalid"], held_issues: [],
      stop_new_at: null, deadline_at: null, remaining_percent: null,
      can_start_issue: false, can_start_agent: false, repairable_issues: [] };
  }
}
const fresh = (at, now, seconds = 60) =>
  typeof at === "string" &&
  Number.isFinite(Date.parse(at)) &&
  Number.isFinite(Date.parse(now)) &&
  Date.parse(at) <= Date.parse(now) &&
  Date.parse(now) - Date.parse(at) <= seconds * 1000;
const ref = (id, digest) => ({
  kind: "source",
  id,
  revision: 1,
  digest,
  location: { kind: "id", target: id },
});
const codes = new Set([
  "accepted",
  "ready",
  "running",
  "no_candidates",
  "awaiting_human",
  "stopped",
  "reconcile_required",
  "finished",
  "issue_limit",
  "worker_capacity",
  "scope_rejected",
  "request_invalid",
  "request_expired",
  "request_reused",
  "profile_expired",
  "inventory_unknown",
  "configuration_changed",
  "claim_binding_invalid",
  "planning_blocked",
  "evidence_missing",
  "evidence_stale",
  "issue_held",
  "repair_limit",
  "review_not_independent",
  "integration_failed",
  "integration_stale",
  "usage_unknown",
  "usage_limit",
  "operation_unknown",
  "operation_limit",
  "observation_limit",
  "report_limit",
  "journal_limit",
  "journal_corrupt",
  "storage_unavailable",
  "port_failed",
  "port_timeout",
  "request_unauthorized",
  "not_ready",
  "assignee_mismatch",
  "approval_missing",
  "issue_blocked",
  "dependency_incomplete",
  "constraint_incomplete",
  "scope_invalid",
  "already_claimed",
  "area_or_path_reserved",
  "owner_capacity",
  "execution_capacity",
  "awaiting_claim_release",
  "merged",
  "writer_unavailable",
]);
const publicCode = (c) => (codes.has(c) ? c : "planning_blocked");
function profileValid(p, now) {
  return (
    validateContinuationArtifact("profile", p).valid &&
    new Set(p.required_stages).size === 4 &&
    p.limits.model_calls === 0 &&
    p.limits.provider_budget === 0 &&
    p.limits.batch_calls <= p.limits.simulated_calls &&
    p.limits.batch_cost_units <= p.limits.simulated_cost_units &&
    p.repository.split("/").every((x) => x !== "." && x !== "..") &&
    Date.parse(p.reviewed_at) <= Date.parse(now) &&
    Date.parse(now) < Date.parse(p.expires_at)
  );
}
export function planContinuation(input) {
  const out = {
    schema_version: 1,
    artifact_kind: "continuation-decision",
    authority: false,
    status: "blocked",
    action: "fence",
    reason: "planning_blocked",
    main_sha: null,
    inventory_digest: null,
    selected: [],
    held: [],
    diagnostics: [],
  };
  try {
    if (
      !safe(input) ||
      Object.keys(input).sort().join() !==
        "inventory,now,profile,requested_issues,state"
    )
      fail("planning_blocked");
    const {
      profile: p,
      inventory: v,
      state: checkpoint,
      requested_issues,
      now,
    } = input;
    if (!profileValid(p, now)) fail("profile_expired");
    if (
      !v ||
      Object.keys(v).sort().join() !==
        "dispatcher_input,main_sha,observed_at,worker_count" ||
      !fresh(v.observed_at, now) ||
      !Number.isInteger(v.worker_count) ||
      v.worker_count < 0 ||
      v.worker_count > p.limits.max_workers
    )
      fail("inventory_unknown");
    const f = structuredClone(v.dispatcher_input),
      s = checkpoint?.state;
    if (
      checkpoint &&
      (!validateContinuationArtifact("checkpoint", checkpoint).valid ||
        checkpoint.profile_digest !== hash(p))
    )
      fail("claim_binding_invalid");
    if (
      f.project?.repository !== p.repository ||
      f.project.repository_id !== p.repository_id ||
      f.profile?.human_owner !== p.human_owner ||
      hash(f.profile) !== p.execution_profile_digest ||
      f.snapshot?.branches?.find((b) => b.name === f.snapshot.default_branch)
        ?.sha !== v.main_sha ||
      !/^[a-f0-9]{40}$/.test(v.main_sha) ||
      !f.snapshot.permissions.some(
        (x) => x.login === p.human_owner && x.actor_id === p.owner_id,
      )
    )
      fail("inventory_unknown");
    if (
      requested_issues !== null &&
      (!Array.isArray(requested_issues) ||
        !requested_issues.length ||
        requested_issues.length > 10 ||
        new Set(requested_issues).size !== requested_issues.length ||
        requested_issues.some((n) => !Number.isSafeInteger(n) || n < 1))
    )
      fail("scope_rejected");
    const excluded = new Set((s?.issues ?? []).map((x) => x.issue_number));
    const scope = f.grant.selected
      .map((t) => t.issue_number)
      .filter(
        (n) =>
          (requested_issues === null || requested_issues.includes(n)) &&
          !excluded.has(n),
      );
    // Only the explicit request filter changes. Keep the full inventory and facts.
    f.requested_issues = scope.length ? scope : requested_issues;
    f.evaluated_at = now;
    const planned = planBatch(f);
    if (planned.status !== "passed") fail("planning_blocked");
    if (planned.configuration_digest !== p.configuration_digest)
      fail("configuration_changed");
    if (s)
      for (const j of s.jobs.filter((j) =>
        ["prepared", "running", "unknown"].includes(j.status),
      ))
        for (const c of j.claims) {
          const actual = f.ledger.claims.find((x) => x.claim_id === c.claim_id);
          if (
            !actual ||
            actual.worker_id !== c.worker_id ||
            actual.generation !== c.generation ||
            f.ledger.generation !== c.generation ||
            actual.head_sha !== c.head_sha
          )
            fail("claim_binding_invalid");
        }
    const active = (s?.issues ?? []).filter(
      (x) => x.status === "running",
    ).length;
    const remaining = Math.max(
      0,
      Math.min(
        p.limits.max_concurrent_issues - active,
        p.limits.max_workers - v.worker_count,
        p.limits.max_issues - (s?.selected_issues.length ?? 0),
      ),
    );
    out.selected = planned.selected
      .filter((x) => !excluded.has(x.issue_number))
      .slice(0, remaining);
    out.held = planned.held.map((x) => ({
      issue_number: x.issue_number,
      reasons: x.reasons.map(publicCode),
    }));
    for (const task of planned.selected
      .filter((x) => !excluded.has(x.issue_number))
      .slice(remaining))
      out.held.push({
        issue_number: task.issue_number,
        reasons: [
          (s?.selected_issues.length ?? 0) >= p.limits.max_issues
            ? "issue_limit"
            : v.worker_count >= p.limits.max_workers
              ? "worker_capacity"
              : "execution_capacity",
        ],
      });
    out.status = "passed";
    out.action = out.selected.length ? "start" : "wait";
    out.reason = out.selected.length
      ? "ready"
      : (s?.selected_issues.length ?? 0) >= p.limits.max_issues
        ? "issue_limit"
        : v.worker_count >= p.limits.max_workers
          ? "worker_capacity"
          : "no_candidates";
    out.main_sha = v.main_sha;
    out.inventory_digest = hash(v);
    if (!validateContinuationArtifact("decision", out).valid)
      fail("planning_blocked");
  } catch (e) {
    out.selected = [];
    out.status = "blocked";
    out.action = "fence";
    out.reason = publicCode(errorCode(e, "planning_blocked"));
    out.diagnostics = [out.reason];
  }
  return out;
}
export function createSyntheticContinuationAdapter(ports) {
  if (
    !ports ||
    [
      "authorizeRequest",
      "observe",
      "reserve",
      "revalidate",
      "start",
      "poll",
      "integrate",
      "notify",
      "stop",
      "reconcile",
    ].some((k) => typeof ports[k] !== "function")
  )
    fail("adapter_invalid");
  const handle = Object.freeze({});
  adapters.set(handle, { ...ports, mode: "synthetic" });
  return handle;
}
function readRegular(path, max) {
  let fd;
  try {
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size > max)
      fail("storage_unavailable");
    return readFileSync(fd, "utf8");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function within(parent, child) {
  const r = relative(parent, child);
  return (
    r === "" || (!r.startsWith(".." + sep) && r !== ".." && !r.startsWith(sep))
  );
}
const NOT_EVALUATED = [
  "native_request_identity",
  "native_delegation",
  "live_github_publication",
  "real_model_usage",
  "production_runner_adoption",
  "host_loss_automatic_cleanup",
  "evidence_retention",
];
export function renderContinuationReport(r) {
  if (!validateContinuationArtifact("report", r).valid) fail("report_invalid");
  const lines = [
    "## 継続制御の実験結果",
    `mode: synthetic / run: ${r.run_id ?? "none"}`,
    `状態: ${r.status} / 理由: ${r.reason}`,
    "",
    "| Issue | PR | head | 状態 |",
    "| --- | --- | --- | --- |",
  ];
  for (const i of r.issues)
    lines.push(
      `| #${i.issue_number} | ${i.pr_number === null ? "未作成" : "#" + i.pr_number} | ${i.head_sha} | ${i.status} |`,
    );
  for (const held of r.held)
    lines.push(
      `保留 #${held.issue_number}: ${held.reasons.map(publicCode).join(", ")}`,
    );
  lines.push(
    "",
    `期間: ${r.started_at ?? "未開始"} / 期限: ${r.deadline ?? "未設定"}`,
    `残作業: ${r.remaining_issues.map((n) => "#" + n).join(", ") || "なし"} / 参考マージ順: ${r.recommended_merge_order.map((n) => "#" + n).join(" → ") || "未評価"}`,
    `合成利用量: ${r.usage.simulated_calls} calls / ${r.usage.simulated_cost_units} units（実課金ではありません）`,
    `予約保持: ${r.usage.reserved_calls} calls / ${r.usage.reserved_cost_units} units`,
    "実モデル呼び出し0 / provider費用0。",
    `未評価: ${r.not_evaluated.join(", ")}`,
    "PR作成は依存完了・claim解放を意味しません。マージは人間が判断します。",
  );
  const text = lines.join("\n");
  if (Buffer.byteLength(text) > 32768) fail("report_limit");
  return text;
}
export async function openContinuation({
  directory,
  profile,
  adapter,
  clock = () => new Date().toISOString(),
}) {
  const ports = adapters.get(adapter);
  if (
    !ports ||
    !validateContinuationArtifact("profile", profile).valid ||
    profile.mode !== "synthetic" ||
    typeof clock !== "function"
  )
    fail("adapter_invalid");
  const p = structuredClone(profile),
    root = realpathSync(directory),
    sourceRoot = realpathSync(new URL("../../", import.meta.url));
  if (
    root !== resolve(directory) ||
    !lstatSync(root).isDirectory() ||
    lstatSync(root).mode & 0o077 ||
    within(sourceRoot, root) ||
    within(root, sourceRoot)
  )
    fail("storage_unavailable");
  const lockPath = join(root, "continuation.lock"),
    owner = randomUUID(),
    lock = openSync(lockPath, "wx", 0o600);
  writeFileSync(lock, JSON.stringify({ owner, pid: process.pid }));
  fsyncSync(lock);
  const path = join(root, "continuation.jsonl");
  let fd,
    closed = false,
    poisoned = false,
    busy = false,
    reconciling = false,
    idle = Promise.resolve(),
    finishTick = () => {},
    sequence = 0,
    lastDigest = null,
    journalBytes = 0,
    abort = new AbortController(),
    driver = null;
  const handles = new Map(),
    reservations = new Map(),
    startups = new Set();
  let state = {
    run_id: null,
    status: "waiting",
    reason: "no_candidates",
    started_at: null,
    deadline: null,
    requested_issues: null,
    stop_fence: false,
    can_resume: false,
    main_sha: null,
    seen: [],
    selected_issues: [],
    held: [],
    recommended_merge_order: [],
    issues: [],
    jobs: [],
    outbox: [],
    usage: {
      simulated_calls: 0,
      simulated_cost_units: 0,
      reserved_calls: 0,
      reserved_cost_units: 0,
    },
    observations: 0,
    operations: 0,
    reports: 0,
    idle: 0,
    artifact_bytes: 0,
    last_inventory_ref: null,
    last_integration_digest: null,
    last_report_ref: null,
  };
  let published = structuredClone(state),
    monotonicStart = performance.now();
  const now = () => {
    const n = clock();
    if (typeof n !== "string" || !Number.isFinite(Date.parse(n)))
      fail("request_expired");
    return n;
  };
  function checkpoint() {
    return {
      schema_version: 1,
      artifact_kind: "continuation-checkpoint",
      mode: "synthetic",
      authority: false,
      profile_digest: hash(p),
      sequence,
      last_digest: lastDigest,
      state: structuredClone(state),
    };
  }
  function releaseLock() {
    closeSync(lock);
    if (JSON.parse(readRegular(lockPath, 1024)).owner === owner)
      unlinkSync(lockPath);
  }
  try {
    fd = openSync(
      path,
      constants.O_RDWR |
        constants.O_CREAT |
        constants.O_APPEND |
        constants.O_NOFOLLOW,
      0o600,
    );
    if (fstatSync(fd).size > p.limits.journal_bytes) fail("journal_corrupt");
    const text = readFileSync(fd, "utf8");
    journalBytes = Buffer.byteLength(text);
    if (text && !text.endsWith("\n")) fail("journal_corrupt");
    for (const line of text.split("\n").filter(Boolean)) {
      const row = JSON.parse(line),
        cp = row.checkpoint;
      if (
        !safe(row) ||
        Object.keys(row).sort().join() !== "action,checkpoint,digest" ||
        !validateContinuationArtifact("checkpoint", cp).valid ||
        cp.profile_digest !== hash(p) ||
        cp.sequence !== sequence + 1 ||
        cp.last_digest !== lastDigest ||
        row.digest !== hash({ action: row.action, checkpoint: cp }) ||
        !safePath(row.action)
      )
        fail("journal_corrupt");
      if (
        sequence &&
        ((state.run_id !== null && cp.state.run_id !== state.run_id) ||
          cp.state.selected_issues.some(
            (x, i) =>
              i < state.selected_issues.length &&
              x !== state.selected_issues[i],
          ) ||
          cp.state.selected_issues.length < state.selected_issues.length ||
          cp.state.operations < state.operations ||
          cp.state.observations < state.observations ||
          cp.state.usage.simulated_calls < state.usage.simulated_calls ||
          cp.state.usage.simulated_cost_units <
            state.usage.simulated_cost_units)
      )
        fail("journal_corrupt");
      state = cp.state;
      sequence = cp.sequence;
      lastDigest = row.digest;
    }
    if (sequence > p.limits.events) fail("journal_limit");
    let bytes = 0;
    for (const name of readdirSync(root)) {
      if (name === "continuation.lock" || name === "continuation.jsonl")
        continue;
      if (!/^record-[a-f0-9]{64}\.json$/.test(name))
        fail("storage_unavailable");
      const raw = readRegular(join(root, name), 5242880),
        value = JSON.parse(raw);
      if (!safe(value) || name !== "record-" + hash(value) + ".json")
        fail("storage_unavailable");
      bytes += Buffer.byteLength(raw);
      if (bytes > p.limits.artifact_bytes) fail("storage_unavailable");
    }
    if (state.artifact_bytes > bytes) fail("storage_unavailable");
    state.artifact_bytes = bytes;
    if (sequence) {
      state.status = "reconcile_required";
      state.reason = "reconcile_required";
      state.stop_fence = true;
      state.can_resume = false;
    }
    published = structuredClone(state);
  } catch (e) {
    if (fd !== undefined) closeSync(fd);
    releaseLock();
    throw e;
  }
  function persist(action) {
    if (closed || poisoned) fail("writer_unavailable");
    const cp = checkpoint();
    cp.sequence = sequence + 1;
    if (
      cp.sequence > p.limits.events ||
      !validateContinuationArtifact("checkpoint", cp).valid
    )
      fail("journal_limit");
    const row = {
        action,
        checkpoint: cp,
        digest: hash({ action, checkpoint: cp }),
      },
      text = JSON.stringify(row) + "\n";
    if (journalBytes + Buffer.byteLength(text) > p.limits.journal_bytes)
      fail("journal_limit");
    try {
      const b = Buffer.from(text);
      let n = 0;
      while (n < b.length) n += writeSync(fd, b, n, b.length - n);
      fsyncSync(fd);
    } catch {
      poisoned = true;
      fail("storage_unavailable");
    }
    sequence = cp.sequence;
    lastDigest = row.digest;
    journalBytes += Buffer.byteLength(text);
    published = structuredClone(state);
  }
  function put(value) {
    if (!safe(value)) fail("evidence_missing");
    const text = JSON.stringify(value),
      bytes = Buffer.byteLength(text);
    if (bytes > 5242880) fail("storage_unavailable");
    const digest = hash(value),
      id = "record-" + digest,
      file = join(root, id + ".json");
    let output;
    try {
      if (state.artifact_bytes + bytes > p.limits.artifact_bytes)
        fail("storage_unavailable");
      output = openSync(file, "wx", 0o600);
      writeFileSync(output, text);
      fsyncSync(output);
      state.artifact_bytes += bytes;
    } catch (e) {
      if (
        e.code !== "EEXIST" ||
        hash(JSON.parse(readRegular(file, 5242880))) !== digest
      )
        throw e;
    } finally {
      if (output !== undefined) closeSync(output);
    }
    const dir = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
    return ref(id, digest);
  }
  function report(request_status = "observed") {
    const s = published,
      r = {
        schema_version: 1,
        artifact_kind: "continuation-report",
        authority: false,
        mode: "synthetic",
        repository: p.repository,
        run_id: s.run_id,
        profile_digest: hash(p),
        policy_digest: p.policy_digest,
        configuration_digest: p.configuration_digest,
        execution_profile_digest: p.execution_profile_digest,
        integration_profile_digest: p.integration_profile_digest,
        main_sha: s.main_sha,
        held: s.held.map((i) => ({
          issue_number: i.issue_number,
          reasons: i.reasons.map(publicCode),
        })),
        recommended_merge_order: s.recommended_merge_order.filter((n) =>
          s.issues.some(
            (i) => i.issue_number === n && i.status === "review_ready",
          ),
        ),
        remaining_issues: [
          ...new Set([
            ...s.issues
              .filter((i) => i.status !== "review_ready")
              .map((i) => i.issue_number),
            ...s.held
              .filter(
                (h) =>
                  !s.issues.some(
                    (i) =>
                      i.issue_number === h.issue_number &&
                      i.status === "review_ready",
                  ),
              )
              .map((h) => h.issue_number),
          ]),
        ],
        status: s.status,
        reason: publicCode(s.reason),
        request_status,
        started_at: s.started_at,
        recorded_at: now(),
        deadline: s.deadline,
        selected_total: s.selected_issues.length,
        issues: s.issues.map((i) => ({
          issue_number: i.issue_number,
          head_sha: i.head_sha,
          plan_digest: i.plan_digest,
          pr_number: i.pr_number,
          status: i.status,
          repairs: i.repairs,
          reasons: i.reasons.map(publicCode),
          proofs: i.proofs.map((proof) => ({
            stage: proof.stage,
            status: proof.status,
            head_sha: proof.head_sha,
            evidence_digest: hash(proof.evidence_refs),
          })),
          evidence_ref: i.evidence_ref,
        })),
        usage: structuredClone(s.usage),
        actual_model_calls: 0,
        provider_cost: 0,
        event_sequence: sequence,
        observations: s.observations,
        operations: s.operations,
        not_evaluated: [...NOT_EVALUATED],
        checkpoint_ref: lastDigest
          ? ref("continuation-event-" + sequence, lastDigest)
          : null,
      };
    if (
      !validateContinuationArtifact("report", r).valid ||
      Buffer.byteLength(JSON.stringify(r)) > 1048576
    )
      fail("report_invalid");
    return r;
  }
  async function call(name, args = {}, work = true, seconds = 10) {
    const controller = new AbortController(),
      signal = controller.signal,
      stop = () => controller.abort();
    let timer;
    if (
      [
        "authorizeRequest",
        "observe",
        "revalidate",
        "poll",
        "reconcile",
      ].includes(name)
    ) {
      if (state.observations >= p.limits.observations)
        fail("observation_limit");
      state.observations++;
      persist("observation-" + name);
    }
    if (work) {
      if (state.stop_fence || abort.signal.aborted) fail("stopped");
      abort.signal.addEventListener("abort", stop, { once: true });
    }
    try {
      return await Promise.race([
        (() => {
          const pending = Promise.resolve().then(() =>
            ports[name]({ ...args, signal }),
          );
          if (name === "start") {
            startups.add(pending);
            pending.then(
              () => startups.delete(pending),
              () => startups.delete(pending),
            );
          }
          return pending;
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("port_timeout"));
          }, seconds * 1000);
          signal.addEventListener("abort", () => reject(new Error("stopped")), {
            once: true,
          });
        }),
      ]);
    } catch {
      fail(work && state.stop_fence ? "stopped" : "port_failed");
    } finally {
      clearTimeout(timer);
      abort.signal.removeEventListener("abort", stop);
    }
  }
  function active() {
    return state.jobs.filter((j) =>
      ["prepared", "running", "unknown"].includes(j.status),
    );
  }
  function demand() {
    if (closed || poisoned) fail("writer_unavailable");
    if (state.stop_fence) fail("stopped");
    if (
      !profileValid(p, now()) ||
      (state.deadline && Date.parse(now()) >= Date.parse(state.deadline)) ||
      performance.now() - monotonicStart >= p.limits.run_seconds * 1000
    )
      fail("profile_expired");
  }
  async function effect(
    kind,
    input,
    fn,
    { control = false, validate = () => true } = {},
  ) {
    if (!control) demand();
    if (state.operations >= p.limits.operations) fail("operation_limit");
    const operation_id =
        "op-" +
        hash({
          run_id: state.run_id,
          kind,
          sequence: state.operations,
          input,
        }).slice(0, 48),
      row = {
        operation_id,
        kind,
        input_digest: hash(input),
        status: "prepared",
      };
    state.operations++;
    state.outbox.push(row);
    persist("intent-" + kind);
    row.status = "sending";
    persist("sending-" + kind);
    try {
      const result = await fn(operation_id);
      if (!validate(result)) fail("operation_unknown");
      if (!control) demand();
      row.status = "confirmed";
      persist("confirmed-" + kind);
      return result;
    } catch (e) {
      row.status = "unknown";
      state.status = "reconcile_required";
      state.reason = "operation_unknown";
      state.stop_fence = true;
      abort.abort();
      persist("unknown-" + kind);
      throw e;
    }
  }
  async function fence(reason = "reconcile_required") {
    state.stop_fence = true;
    state.can_resume = false;
    state.status = "reconcile_required";
    state.reason = publicCode(reason);
    abort.abort();
    try {
      persist("fence");
    } catch {
      poisoned = true;
    }
    let result, timer;
    try {
      await Promise.race([
        Promise.allSettled([...startups]),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error()),
            Math.min(10000, p.limits.cleanup_seconds * 1000),
          );
        }),
      ]);
      clearTimeout(timer);
    } catch {
    } finally {
      clearTimeout(timer);
    }
    try {
      result = await call(
        "stop",
        {
          run_id: state.run_id,
          profile_digest: hash(p),
          batch_ids: active().map((j) => j.batch_id),
        },
        false,
        Math.min(10, p.limits.cleanup_seconds),
      );
    } catch {
    } finally {
      clearTimeout(timer);
    }
    const confirmed = result?.stopped === true && startups.size === 0;
    if (confirmed) {
      for (const j of active()) j.status = "stopped";
      for (const i of state.issues.filter((i) => i.status === "running")) {
        i.status = "held";
        i.reasons = ["stopped"];
      }
      state.reason = reason === "stopped" ? "stopped" : publicCode(reason);
      if (
        !state.jobs.some((j) => !j.settled) &&
        !state.outbox.some((o) => o.status === "unknown")
      )
        state.status = "stopped";
    }
    try {
      persist("stopped");
    } catch {
      poisoned = true;
      published = {
        ...structuredClone(state),
        status: "reconcile_required",
        reason: "storage_unavailable",
      };
    }
    if (!poisoned && state.reports < p.limits.reports) {
      try {
        state.last_report_ref = put(report());
        state.reports++;
        persist("stop-report");
      } catch {}
    }
    return confirmed;
  }
  async function notice(kind) {
    if (state.reports >= p.limits.reports) fail("report_limit");
    const value = report(),
      summary = renderContinuationReport(value);
    if (Buffer.byteLength(summary) > p.limits.summary_bytes)
      fail("report_limit");
    const evidence = put(value);
    state.last_report_ref = evidence;
    state.reports++;
    persist("report-ready");
    const report_digest = hash(value),
      result = await effect(
        "notify",
        { kind, report_digest },
        () => call("notify", { kind, report: value, summary, report_digest }),
        {
          validate: (result) =>
            safe(result) &&
            result.confirmed === true &&
            result.report_digest === report_digest,
        },
      );
    if (
      !safe(result) ||
      result.confirmed !== true ||
      result.report_digest !== report_digest
    )
      fail("operation_unknown");
  }
  async function observe() {
    demand();
    const v = await call("observe", {
      run_id: state.run_id,
      profile_digest: hash(p),
    });
    if (!safe(v)) fail("inventory_unknown");
    state.last_inventory_ref = put(v);
    persist("observed");
    return v;
  }
  function bindingFor(claim, v) {
    const target = v.dispatcher_input.grant.selected.find(
      (t) => t.issue_number === claim.issue_number,
    );
    if (
      !target ||
      claim.head_sha !== target.head_sha ||
      claim.profile_digest !== p.execution_profile_digest ||
      claim.run_id !== v.dispatcher_input.grant.run_id ||
      claim.generation !== v.dispatcher_input.ledger.generation
    )
      fail("claim_binding_invalid");
    return {
      claim_id: claim.claim_id,
      worker_id: claim.worker_id,
      generation: claim.generation,
      issue_number: claim.issue_number,
      run_id: claim.run_id,
      head_sha: claim.head_sha,
      profile_digest: claim.profile_digest,
      plan_digest: target.plan.digest,
    };
  }
  async function start(decision, v) {
    const usage = state.usage;
    if (
      usage.simulated_calls + usage.reserved_calls + p.limits.batch_calls >
        p.limits.simulated_calls ||
      usage.simulated_cost_units +
        usage.reserved_cost_units +
        p.limits.batch_cost_units >
        p.limits.simulated_cost_units
    )
      fail("usage_limit");
    const numbers = decision.selected.map((t) => t.issue_number),
      r = await effect(
        "reserve",
        { issues: numbers, inventory_digest: decision.inventory_digest },
        (id) =>
          call("reserve", {
            issue_numbers: numbers,
            operation_id: id,
            parent_run_id: state.run_id,
          }),
        {
          validate: (r) =>
            !!r &&
            r.status === "passed" &&
            Array.isArray(r.reservations) &&
            r.reservations.length === numbers.length &&
            new Set(r.reservations.map((x) => x.claim?.issue_number)).size ===
              numbers.length &&
            r.reservations.every(
              (x) => numbers.includes(x.claim?.issue_number) && x.handle,
            ),
        },
      );
    if (
      !r ||
      r.status !== "passed" ||
      !Array.isArray(r.reservations) ||
      r.reservations.length !== numbers.length ||
      new Set(r.reservations.map((x) => x.claim?.issue_number)).size !==
        numbers.length ||
      r.reservations.some(
        (x) => !numbers.includes(x.claim?.issue_number) || !x.handle,
      )
    )
      fail("operation_unknown");
    for (const reservation of r.reservations) {
      const result = await call("revalidate", { reservation });
      if (result?.status !== "passed") fail("claim_binding_invalid");
    }
    const claims = r.reservations.map((x) => bindingFor(x.claim, v)),
      batch_id =
        "batch-" +
        hash({ run: state.run_id, operation: state.operations, claims }).slice(
          0,
          40,
        ),
      job = {
        batch_id,
        status: "prepared",
        claims,
        reserved_calls: p.limits.batch_calls,
        reserved_cost_units: p.limits.batch_cost_units,
        settled: false,
      };
    state.jobs.push(job);
    usage.reserved_calls += job.reserved_calls;
    usage.reserved_cost_units += job.reserved_cost_units;
    for (const c of claims) {
      if (state.selected_issues.includes(c.issue_number))
        fail("claim_binding_invalid");
      state.selected_issues.push(c.issue_number);
      state.issues.push({
        issue_number: c.issue_number,
        claim_id: c.claim_id,
        head_sha: c.head_sha,
        plan_digest: c.plan_digest,
        pr_number: null,
        status: "running",
        repairs: 0,
        reasons: [],
        proofs: [],
        evidence_ref: null,
      });
    }
    reservations.set(batch_id, r.reservations);
    persist("batch-reserved");
    await effect("start", { batch_id, claims }, async (operation_id) => {
      const promise = call(
        "start",
        {
          batch_id,
          reservations: r.reservations,
          parent_run_id: state.run_id,
          operation_id,
        },
        true,
        p.limits.call_seconds,
      );
      startups.add(promise);
      try {
        const handle = await promise;
        if (!handle) fail("operation_unknown");
        handles.set(batch_id, handle);
        return handle;
      } finally {
        startups.delete(promise);
      }
    });
    job.status = "running";
    state.idle = 0;
    persist("batch-running");
  }
  function settle(job, usage) {
    if (job.settled) return;
    if (
      !safe(usage) ||
      usage.status !== "known" ||
      !Number.isSafeInteger(usage.calls) ||
      !Number.isSafeInteger(usage.cost_units) ||
      usage.calls < 0 ||
      usage.cost_units < 0 ||
      usage.calls > job.reserved_calls ||
      usage.cost_units > job.reserved_cost_units
    )
      fail("usage_unknown");
    state.usage.simulated_calls += usage.calls;
    state.usage.simulated_cost_units += usage.cost_units;
    state.usage.reserved_calls -= job.reserved_calls;
    state.usage.reserved_cost_units -= job.reserved_cost_units;
    job.settled = true;
  }
  function acceptOutcome(raw, job) {
    if (
      !safe(raw) ||
      Object.keys(raw).sort().join() !==
        "claim_id,head_sha,issue_number,plan_digest,pr_number,proofs,repairs,status"
    )
      fail("evidence_missing");
    const c = job.claims.find(
        (c) =>
          c.issue_number === raw.issue_number && c.claim_id === raw.claim_id,
      ),
      item = state.issues.find((i) => i.issue_number === raw.issue_number);
    if (!c || !item) fail("claim_binding_invalid");
    const value = {
      ...structuredClone(raw),
      status: "held",
      reasons: [],
      evidence_ref: null,
    };
    const cp = checkpoint();
    cp.state.issues = [value];
    if (!validateContinuationArtifact("checkpoint", cp).valid)
      fail("evidence_missing");
    value.evidence_ref = put(raw);
    let reason =
      raw.status !== "passed"
        ? "issue_held"
        : raw.repairs > p.limits.max_repairs
          ? "repair_limit"
          : raw.head_sha !== c.head_sha || raw.plan_digest !== c.plan_digest
            ? "evidence_stale"
            : null;
    if (!reason) {
      const seen = new Set();
      for (const proof of raw.proofs) {
        if (
          seen.has(proof.stage) ||
          proof.status !== "passed" ||
          proof.head_sha !== c.head_sha ||
          proof.plan_digest !== c.plan_digest ||
          proof.profile_digest !== p.execution_profile_digest
        )
          reason = "evidence_stale";
        seen.add(proof.stage);
      }
      if (!p.required_stages.every((s) => seen.has(s)))
        reason = "evidence_missing";
    }
    if (!reason) {
      const impl = raw.proofs.find(
          (x) => x.stage === "implementation",
        )?.context_id,
        review = raw.proofs.find((x) => x.stage === "review")?.context_id;
      if (!impl || !review || impl === review)
        reason = "review_not_independent";
    }
    value.status = reason ? "held" : "integration_pending";
    value.reasons = reason ? [reason] : [];
    Object.assign(item, value);
  }
  async function poll() {
    for (const job of state.jobs.filter((j) => j.status === "running")) {
      const handle = handles.get(job.batch_id),
        rs = reservations.get(job.batch_id);
      if (!handle || !rs) fail("reconcile_required");
      for (const reservation of rs) {
        if ((await call("revalidate", { reservation }))?.status !== "passed")
          fail("claim_binding_invalid");
      }
      const value = await call(
        "poll",
        { handle, batch_id: job.batch_id, parent_run_id: state.run_id },
        true,
        p.limits.call_seconds,
      );
      demand();
      if (!safe(value) || !["running", "complete"].includes(value.status))
        fail("operation_unknown");
      if (value.status === "running") {
        if (
          !Number.isInteger(value.worker_count) ||
          value.worker_count < 0 ||
          value.worker_count > p.limits.max_workers
        )
          fail("worker_capacity");
        continue;
      }
      if (
        value.worker_stopped !== true ||
        !Array.isArray(value.items) ||
        value.items.length !== job.claims.length ||
        new Set(value.items.map((i) => i.issue_number)).size !==
          value.items.length
      )
        fail("operation_unknown");
      settle(job, value.usage);
      for (const outcome of value.items) acceptOutcome(outcome, job);
      job.status = "complete";
      persist("batch-complete");
    }
  }
  async function integrate(v) {
    const eligible = state.issues.filter((i) =>
      ["integration_pending", "review_ready"].includes(i.status),
    );
    if (!eligible.length) return;
    const snapshot = v.dispatcher_input.snapshot;
    for (const item of eligible) {
      const t = v.dispatcher_input.grant.selected.find(
          (t) => t.issue_number === item.issue_number,
        ),
        pr = snapshot.prs.find((pr) => pr.number === item.pr_number);
      if (
        !t ||
        t.head_sha !== item.head_sha ||
        t.plan.digest !== item.plan_digest ||
        !pr ||
        pr.head_sha !== item.head_sha ||
        pr.head_repository_id !== p.repository_id ||
        pr.state !== "open" ||
        pr.merged
      ) {
        item.status = "held";
        item.reasons = ["evidence_stale"];
      }
    }
    const targets = eligible
      .filter((i) => i.status !== "held")
      .map((i) => ({
        issue_number: i.issue_number,
        head_sha: i.head_sha,
        plan_digest: i.plan_digest,
      }));
    if (!targets.length) {
      persist("stale-subjects");
      return;
    }
    const digest = hash({
      main_sha: v.main_sha,
      targets,
      profile_digest: p.integration_profile_digest,
    });
    if (state.last_integration_digest === digest) return;
    const result = await effect("integrate", { digest, targets }, () =>
      call(
        "integrate",
        {
          main_sha: v.main_sha,
          targets,
          profile_digest: p.integration_profile_digest,
          parent_run_id: state.run_id,
        },
        true,
        p.limits.call_seconds,
      ),
    );
    if (
      !safe(result) ||
      !["passed", "failed", "not_evaluated", "error"].includes(result.status) ||
      !Array.isArray(result.evidence_refs) ||
      !result.evidence_refs.length
    )
      fail("evidence_missing");
    // Re-observe before declaring readiness or selecting more work. The main
    // branch and source authority may have changed during the P6 call.
    const latest = await observe(),
      decision = planContinuation({
        profile: p,
        inventory: latest,
        state: checkpoint(),
        requested_issues: state.requested_issues,
        now: now(),
      });
    if (decision.status !== "passed") fail(decision.reason);
    const pinsCurrent = targets.every((t) => {
        const target = latest.dispatcher_input.grant.selected.find(
            (x) => x.issue_number === t.issue_number,
          ),
          item = state.issues.find((x) => x.issue_number === t.issue_number),
          pr = latest.dispatcher_input.snapshot.prs.find(
            (x) => x.number === item.pr_number,
          );
        return (
          target?.head_sha === t.head_sha &&
          target.plan.digest === t.plan_digest &&
          pr?.head_sha === t.head_sha &&
          pr.state === "open" &&
          !pr.merged &&
          pr.head_repository_id === p.repository_id
        );
      }),
      mainCurrent = latest.main_sha === v.main_sha;
    state.main_sha = latest.main_sha;
    const passed =
        pinsCurrent &&
        mainCurrent &&
        result.status === "passed" &&
        result.main_sha === v.main_sha &&
        result.profile_digest === p.integration_profile_digest &&
        same(result.targets, targets),
      evidence = put(result);
    for (const item of state.issues.filter((i) =>
      targets.some((t) => t.issue_number === i.issue_number),
    )) {
      item.status = passed
        ? "review_ready"
        : !mainCurrent && pinsCurrent
          ? "integration_pending"
          : "held";
      item.reasons = passed
        ? []
        : [
            !mainCurrent || !pinsCurrent || result.main_sha !== v.main_sha
              ? "integration_stale"
              : "integration_failed",
          ];
      item.evidence_ref = evidence;
    }
    const order = result.recommended_merge_order;
    state.recommended_merge_order =
      passed &&
      Array.isArray(order) &&
      order.length === targets.length &&
      new Set(order).size === order.length &&
      order.every((n) => targets.some((t) => t.issue_number === n))
        ? [...order]
        : [];
    state.last_integration_digest = digest;
    persist("integration-result");
    await notice(passed ? "review_ready" : "judgment");
    return latest;
  }
  let api;
  async function tick() {
    if (busy || state.status !== "running" || state.stop_fence || closed)
      return report();
    busy = true;
    idle = new Promise((resolve) => {
      finishTick = resolve;
    });
    try {
      demand();
      let v = await observe(),
        decision = planContinuation({
          profile: p,
          inventory: v,
          state: checkpoint(),
          requested_issues: state.requested_issues,
          now: now(),
        });
      if (decision.status !== "passed") fail(decision.reason);
      if (state.main_sha && state.main_sha !== v.main_sha) {
        state.last_integration_digest = null;
        state.recommended_merge_order = [];
        for (const i of state.issues.filter(
          (i) => i.status === "review_ready",
        )) {
          i.status = "integration_pending";
          i.reasons = ["integration_stale"];
        }
      }
      state.main_sha = v.main_sha;
      persist("pins-observed");
      const before = state.jobs.filter((j) => j.status === "complete").length;
      await poll();
      if (state.jobs.filter((j) => j.status === "complete").length !== before) {
        v = await observe();
        decision = planContinuation({
          profile: p,
          inventory: v,
          state: checkpoint(),
          requested_issues: state.requested_issues,
          now: now(),
        });
        if (decision.status !== "passed") fail(decision.reason);
      }
      v = (await integrate(v)) ?? v;
      demand();
      decision = planContinuation({
        profile: p,
        inventory: v,
        state: checkpoint(),
        requested_issues: state.requested_issues,
        now: now(),
      });
      if (decision.status !== "passed") fail(decision.reason);
      state.held = structuredClone(decision.held);
      if (decision.selected.length) {
        await start(decision, v);
      } else if (!active().length) {
        state.idle++;
        state.reason =
          decision.reason === "issue_limit" ? "issue_limit" : "awaiting_human";
        if (state.idle >= p.limits.idle_observations) {
          state.idle = p.limits.idle_observations;
          state.status = "waiting";
          persist("waiting");
          await notice("finish");
        } else persist("idle");
      } else {
        state.idle = 0;
        persist("running");
      }
    } catch (e) {
      const reason = errorCode(e, "port_failed");
      await fence(reason === "stopped" ? "stopped" : publicCode(reason));
    } finally {
      busy = false;
      finishTick();
    }
    return report();
  }
  async function drive() {
    if (driver) return driver;
    const work = (async () => {
      while (state.status === "running" && !state.stop_fence && !closed) {
        await tick();
        if (state.status !== "running") break;
        await new Promise((resolve) => {
          const done = () => {
            clearTimeout(timer);
            abort.signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, p.limits.monitor_seconds * 1000);
          abort.signal.addEventListener("abort", done, { once: true });
          if (abort.signal.aborted) done();
        });
      }
      return report();
    })();
    driver = work;
    try {
      return await work;
    } finally {
      driver = null;
    }
  }
  async function verifyRequest(request) {
    if (
      !validateContinuationArtifact("request", request).valid ||
      request.repository !== p.repository ||
      request.repository_id !== p.repository_id ||
      request.owner_id !== p.owner_id ||
      request.profile_digest !== hash(p) ||
      request.policy_digest !== p.policy_digest ||
      request.source.actor_id !== p.owner_id ||
      request.source.actor_type !== "User" ||
      !fresh(request.issued_at, now()) ||
      Date.parse(request.expires_at) <= Date.parse(now()) ||
      Date.parse(request.expires_at) - Date.parse(request.issued_at) > 60000 ||
      Date.parse(request.source.updated_at) > Date.parse(request.issued_at)
    )
      fail("request_invalid");
    const binding_digest = hash({ profile: p, request }),
      proof = await call(
        "authorizeRequest",
        {
          request: structuredClone(request),
          profile: structuredClone(p),
          binding_digest,
        },
        false,
      );
    if (
      !safe(proof) ||
      Object.keys(proof).sort().join() !==
        "allowed,binding_digest,mode,observed_at" ||
      proof.mode !== "synthetic" ||
      proof.allowed !== true ||
      proof.binding_digest !== binding_digest ||
      !fresh(proof.observed_at, now())
    )
      fail("request_unauthorized");
  }
  async function accept(request, { drive: run = true, wait = true } = {}) {
    try {
      if (closed || poisoned) fail("writer_unavailable");
      if (!safe(request)) fail("request_invalid");
      request = structuredClone(request);
      await verifyRequest(request);
      if (request.intent === "status") return report("observed");
      if (state.run_id && request.run_id !== state.run_id)
        fail("scope_rejected");
      const old = state.seen.find(
        (x) => x.event_id === request.event_id || x.nonce === request.nonce,
      );
      if (old) {
        if (old.digest !== hash(request)) fail("request_reused");
        return report("duplicate");
      }
      if (state.seen.length >= 1000) fail("operation_limit");
      if (
        request.intent !== "stop" &&
        state.requested_issues !== null &&
        (request.requested_issues === null ||
          request.requested_issues.some(
            (n) => !state.requested_issues.includes(n),
          ))
      )
        fail("scope_rejected");
      if (!state.run_id) {
        if (request.intent !== "continue" || !profileValid(p, now()))
          fail("request_invalid");
        state.run_id = request.run_id;
        state.started_at = now();
        state.deadline = new Date(
          Math.min(
            Date.parse(now()) + p.limits.run_seconds * 1000,
            Date.parse(p.expires_at),
          ),
        ).toISOString();
        monotonicStart = performance.now();
        state.requested_issues = structuredClone(request.requested_issues);
      }
      state.seen.push({
        event_id: request.event_id,
        nonce: request.nonce,
        digest: hash(request),
      });
      persist("request");
      if (request.intent === "stop") {
        await fence("stopped");
        return report("accepted");
      }
      if (request.intent === "constrain") {
        if (request.requested_issues === null) fail("scope_rejected");
        state.requested_issues = [...request.requested_issues];
        persist("constrained");
        if (
          active().some((j) =>
            j.claims.some(
              (c) => !state.requested_issues.includes(c.issue_number),
            ),
          )
        )
          await fence("stopped");
        return report("accepted");
      }
      if (state.stop_fence) {
        if (!state.can_resume) return report("rejected");
        abort = new AbortController();
        state.stop_fence = false;
        state.can_resume = false;
      }
      if (
        !profileValid(p, now()) ||
        Date.parse(now()) >= Date.parse(state.deadline)
      )
        fail("profile_expired");
      state.requested_issues = structuredClone(request.requested_issues);
      state.status = "running";
      state.reason = "accepted";
      state.idle = 0;
      persist("continued");
      await notice("start");
      if (run) {
        if (wait) return await drive();
        void drive().catch(() => {});
      }
      return report("accepted");
    } catch (e) {
      if (
        state.stop_fence ||
        state.outbox.some((x) => x.status === "unknown")
      ) {
        await fence("operation_unknown");
        return report("rejected");
      }
      return report("rejected");
    }
  }
  async function reconcile() {
    if (
      closed ||
      busy ||
      reconciling ||
      (!state.stop_fence && state.status !== "reconcile_required")
    )
      return report("rejected");
    reconciling = true;
    try {
      const expectedSequence = sequence + 1,
        state_digest = hash(state),
        value = await call(
          "reconcile",
          { run_id: state.run_id, state_digest, profile_digest: hash(p) },
          false,
          Math.min(10, p.limits.cleanup_seconds),
        );
      if (
        sequence !== expectedSequence ||
        startups.size !== 0 ||
        !safe(value) ||
        value.state_digest !== state_digest ||
        !fresh(value.observed_at, now()) ||
        value.workers_stopped !== true ||
        value.operations_reconciled !== true ||
        !Array.isArray(value.settlements)
      )
        fail("reconcile_required");
      for (const job of state.jobs.filter((j) => !j.settled)) {
        const row = value.settlements.find((x) => x.batch_id === job.batch_id);
        if (!row) fail("usage_unknown");
        settle(job, row.usage);
        job.status = "stopped";
      }
      for (const operation of state.outbox.filter(
        (o) => o.status === "unknown",
      ))
        operation.status = "confirmed";
      for (const item of state.issues.filter((i) => i.status === "running")) {
        item.status = "held";
        item.reasons = ["stopped"];
      }
      state.status = "stopped";
      state.reason = "stopped";
      state.stop_fence = true;
      state.can_resume = true;
      persist("reconciled");
    } catch {
      state.status = "reconcile_required";
      state.reason = "reconcile_required";
      state.stop_fence = true;
      try {
        persist("reconcile-blocked");
      } catch {
        poisoned = true;
      }
    } finally {
      reconciling = false;
    }
    return report();
  }
  api = Object.freeze({
    accept,
    tick,
    status: async () => report(),
    stop: async () => {
      await fence("stopped");
      return report();
    },
    reconcile,
    async close() {
      if (closed) return;
      let stopped = true;
      if (active().length || busy) stopped = await fence("stopped");
      if (busy) {
        let timer;
        try {
          await Promise.race([
            idle,
            new Promise((resolve) => {
              timer = setTimeout(
                resolve,
                Math.min(10000, p.limits.cleanup_seconds * 1000),
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        if (busy) stopped = false;
      }
      closed = true;
      abort.abort();
      closeSync(fd);
      if (stopped) releaseLock();
      else closeSync(lock);
    },
  });
  return api;
}
