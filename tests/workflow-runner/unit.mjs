import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { profile, signedRequest, time } from "./fixture.mjs";
import {
  ADAPTER_DIGEST,
  canonical,
  hash,
} from "../../tools/workflow-runner/core.mjs";
import {
  createGitHubRequestIssuer,
  createGitHubRequestReader,
  createRunnerAuthority,
  verifyRequest,
} from "../../tools/workflow-runner/authority.mjs";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, serveControl } from "../../tools/workflow-runner/cli.mjs";
import { parseCodexEvents } from "../../tools/workflow-runner/adapter.mjs";
import { dockerArgs } from "../../tools/workflow-runner/adapter.mjs";
import {
  fixture as execution,
  rebind,
  source,
} from "../workflow-execution/fixture.mjs";
import { checkRunnerEvidence } from "../../tools/workflow-runner/supervisor.mjs";
import { createGateway } from "../../tools/workflow-runner/gateway.mjs";
import { openLedger } from "../../tools/workflow-runner/supervisor.mjs";
import { checkProfile } from "../../tools/workflow-runner/core.mjs";
import { createSyntheticAdapter } from "../../tools/workflow-runner/adapter.mjs";
import { openSupervisor } from "../../tools/workflow-runner/supervisor.mjs";
import {
  collectArtifacts,
  prepareWorkspace,
} from "../../tools/workflow-runner/workspace.mjs";

const continuationImports =
  process.env.WORKFLOW_CONTINUATION_TEST === "1"
    ? await Promise.all([
        import("../../tools/workflow-continuation/controller.mjs"),
        import("../workflow-dispatch/fixture.mjs"),
        import("node:fs"),
      ])
    : null;

// An optional, synchronous budget decision. These inputs are synthetic observations,
// never grants, a real quota reading, or evidence that any worker was stopped.
if (process.env.WORKFLOW_CONTINUATION_TEST === "1") {
  const budget = (input) => continuationImports[0].decideContinuationBudget(input);
  const start = "2026-11-10T00:00:00Z";
  const at = (minutes) => new Date(Date.parse(start) + minutes * 60000).toISOString();
  const input = () => ({
    policy: { schema_version: 1, artifact_kind: "autonomy-settings", revision: 1,
      limits: { issues: 2, minutes: 60, parallel_issues: 1, repair_rounds: 2 },
      quota: { stop_new_remaining_percent: 30, checkpoint_remaining_percent: 15 } },
    run: { started_at: start, last_checked_at: start,
      issues: [{ number: 81, repair_rounds: 0 }], active_issues: [], active_agents: 1,
      stop_requested: false, authorization_lost: false, storage_failed: false, work_unknown: false },
    observation: { status: "unsupported" }, now: at(10),
  });
  const observed = (v) => {
    v.observation = { status: "available", retry_count: 0, observed_at: v.now,
      expected_scope: { account_ref: "synthetic-account", workspace_ref: "synthetic-workspace", window_ids: ["short", "long"] },
      observed_scope: { account_ref: "synthetic-account", workspace_ref: "synthetic-workspace" },
      windows: ["short", "long"].map(id => ({ id, metric: "remaining_percent", value: 80 })),
      warning: false, exhausted: false };
    return v;
  };
  const freeze = (v) => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
  const closed = (r) => {
    assert.equal(r.decision, "checkpoint"); assert.equal(r.authority, false);
    assert.equal(r.can_start_issue, false); assert.equal(r.can_start_agent, false);
    assert.deepEqual(r.repairable_issues, []);
    assert.equal(JSON.stringify(r).includes("credential-sentinel"), false);
  };
  test("P7 Budget: unsupported quota is unknown, deterministic and immutable, never authority", () => {
    const v = freeze(input()), before = JSON.stringify(v), r = budget(v);
    assert.deepEqual(r, { schema_version: 1, artifact_kind: "autonomy-budget-decision", authority: false,
      decision: "continue", reason_codes: [], held_issues: [], stop_new_at: at(50), deadline_at: at(60),
      remaining_percent: null, can_start_issue: true, can_start_agent: true, repairable_issues: [] });
    assert.deepEqual(budget(v), r); assert.equal(JSON.stringify(v), before);
    r.reason_codes.push("mutated-output"); assert.deepEqual(budget(v).reason_codes, []);
  });
  test("P7 Budget: valid policy changes retain fixed ten-minute save margin", () => {
    for (const minutes of [11, 90, 360]) {
      const v = input(); v.policy.revision = 2; v.policy.limits.minutes = minutes; v.now = at(0);
      assert.equal(budget(v).deadline_at, at(minutes)); assert.equal(budget(v).stop_new_at, at(minutes - 10));
    }
    const v = input(); v.now = "2026-11-10T09:10:00+09:00";
    assert.deepEqual(budget(v), budget(input()));
  });
  for (const [minutes, decision] of [[49 + 59 / 60, "continue"], [50, "stop_new"], [59 + 59 / 60, "stop_new"], [60, "checkpoint"]]) {
    test(`P7 Budget: time boundary ${minutes} is ${decision}`, () => {
      const v = input(); v.now = at(minutes); const r = budget(v); assert.equal(r.decision, decision);
      if (decision !== "continue") { assert.equal(r.can_start_issue, false); assert.equal(r.can_start_agent, false); }
      if (decision === "checkpoint") closed(r);
    });
  }
  test("P7 Budget: 90-minute run stops new work at 80, expires at 90 without reset", () => {
    const v = input(); v.policy.limits.minutes = 90;
    v.now = at(80); assert.equal(budget(v).decision, "stop_new");
    v.now = at(90); closed(budget(v)); assert.equal(budget(v).deadline_at, at(90));
    assert.equal(v.run.started_at, start);
  });
  test("P7 Budget: invalid, missing and reversed clocks cannot open a new run", () => {
    const mutations = [v => v.now = "credential-sentinel", v => v.now = "2026-02-30T00:00:00Z",
      v => v.now = "2026-11-10", v => v.run.last_checked_at = at(11),
      v => v.run.started_at = at(1), v => delete v.run.started_at];
    for (const mutate of mutations) { const v = input(); mutate(v); closed(budget(v)); }
  });
  for (const [flag, code] of [["stop_requested", "budget_stopped"], ["authorization_lost", "budget_authority_lost"],
    ["storage_failed", "budget_storage_failed"], ["work_unknown", "budget_work_unknown"]]) {
    test(`P7 Budget: ${flag} takes precedence over available capacity`, () => {
      const v = input(); v.run[flag] = true; const r = budget(v); closed(r); assert(r.reason_codes.includes(code));
    });
  }
  test("P7 Budget: policy type, version, unknown fields, bounds and cross-relations fail closed", () => {
    const changes = [v => v.policy.schema_version = 2, v => v.policy.revision = 0,
      v => v.policy.extra = "credential-sentinel", v => delete v.policy.quota,
      v => v.policy.limits = null, v => v.policy.quota.checkpoint_remaining_percent = 30,
      v => { v.policy.limits.issues = 1; v.policy.limits.parallel_issues = 2; }];
    for (const [key, values] of Object.entries({ issues: [0, 11, "2", null], minutes: [10, 361, 1.5], parallel_issues: [0, 3], repair_rounds: [-1, 4] }))
      for (const value of values) changes.push(v => v.policy.limits[key] = value);
    for (const [key, values] of Object.entries({ stop_new_remaining_percent: [1, 101, "30"], checkpoint_remaining_percent: [0, 100] }))
      for (const value of values) changes.push(v => v.policy.quota[key] = value);
    for (const change of changes) { const v = input(); change(v); closed(budget(v)); }
  });
  test("P7 Budget: malformed run collections and unknown input fields fail closed", () => {
    const changes = [v => v.private = "credential-sentinel", v => v.run.extra = true,
      v => delete v.run.storage_failed, v => v.run.stop_requested = "false", v => v.run.issues = null,
      v => v.run.issues.push({ number: 81, repair_rounds: 0 }), v => v.run.issues[0].number = 0,
      v => v.run.issues[0].number = Number.MAX_SAFE_INTEGER + 1,
      v => v.run.issues[0].repair_rounds = 4, v => v.run.active_issues = [82],
      v => v.run.active_issues = [81, 81], v => v.run.active_agents = -1, v => v.run.active_agents = 4,
      v => v.run.issues = Array.from({ length: 11 }, (_, n) => ({ number: n + 1, repair_rounds: 0 })),
      v => v.observation.extra = "credential-sentinel"];
    for (const change of changes) { const v = input(); change(v); closed(budget(v)); }
    for (const v of [undefined, null, [], true, "credential-sentinel", {}]) closed(budget(v));
  });
  test("P7 Budget: non-JSON values, accessors, cycles and proxies are not evaluated", () => {
    let reads = 0;
    const getter = input(); Object.defineProperty(getter.run, "secret", { enumerable: true, get() { reads++; throw Error("credential-sentinel"); } });
    const proxy = new Proxy({}, { ownKeys() { reads++; throw Error("credential-sentinel"); } });
    const cycle = input(); cycle.run.loop = cycle;
    const values = [getter, proxy, cycle];
    for (const bad of [NaN, Infinity, -Infinity, 1n, () => {}, new Date(), Symbol("secret")]) { const v = input(); v.run.active_agents = bad; values.push(v); }
    for (const v of values) closed(budget(v)); assert.equal(reads, 0);
  });
  for (const [remaining, decision] of [[0, "checkpoint"], [15, "checkpoint"], [16, "stop_new"], [30, "stop_new"], [31, "continue"], [99.5, "continue"], [100, "continue"]]) {
    test(`P7 Budget: remaining ${remaining} has inclusive threshold decision ${decision}`, () => {
      const v = observed(input()); v.observation.windows[0].value = remaining;
      const r = budget(v); assert.equal(r.decision, decision); assert.equal(r.remaining_percent, remaining);
      if (decision === "checkpoint") closed(r);
    });
  }
  test("P7 Budget: uses the minimum of all required windows and converts used percent", () => {
    const v = observed(input()); v.observation.windows[1] = { id: "long", metric: "used_percent", value: 80 };
    const r = budget(v); assert.equal(r.remaining_percent, 20); assert.equal(r.decision, "stop_new");
    v.observation.windows.reverse(); assert.deepEqual(budget(v), r);
  });
  test("P7 Budget: exactly 60 seconds is fresh, 61 seconds/future/bad scopes are unknown", () => {
    const v = observed(input()); v.observation.observed_at = at(9);
    assert.equal(budget(v).decision, "continue");
    const changes = [v => v.observation.observed_at = at(10 - 61 / 60), v => v.observation.observed_at = at(11),
      v => v.observation.observed_at = "credential-sentinel", v => v.observation.observed_scope.account_ref = "other",
      v => v.observation.observed_scope.workspace_ref = "other", v => v.observation.windows.pop(),
      v => v.observation.windows[0].id = "unrelated", v => v.observation.windows[0].value = -1,
      v => v.observation.windows[0].value = 101, v => v.observation.windows[0].value = "80",
      v => v.observation.windows[0].metric = "tokens", v => v.observation.windows.push(v.observation.windows[0]),
      v => v.observation.expected_scope.window_ids.push("short"),
      v => v.observation.expected_scope.account_ref = "x".repeat(129), v => v.observation.windows = []];
    for (const change of changes) for (const retry of [0, 1]) {
      const f = observed(input()); change(f); f.observation.retry_count = retry;
      const r = budget(f); assert.equal(r.decision, retry ? "checkpoint" : "stop_new");
      assert(r.reason_codes.includes("budget_quota_unknown")); assert.equal(r.remaining_percent, null);
      assert.equal(r.can_start_issue, false); assert.equal(r.can_start_agent, false);
    }
  });
  test("P7 Budget: unsupported quota and a failed supported source never share a fallback", () => {
    const v = input(); assert.equal(budget(v).decision, "continue");
    for (const retry of [0, 1]) {
      v.observation = { status: "unavailable", retry_count: retry };
      assert.equal(budget(v).decision, retry ? "checkpoint" : "stop_new");
    }
    v.observation.retry_count = 2; closed(budget(v));
    v.observation = { status: "unknown" }; closed(budget(v));
  });
  test("P7 Budget: warnings and exhaustion checkpoint even when a sample is unusable", () => {
    for (const flag of ["warning", "exhausted"]) for (const value of [99, -1]) {
      const v = observed(input()); v.observation[flag] = true; v.observation.windows[0].value = value;
      const r = budget(v); closed(r); assert(r.reason_codes.includes("budget_quota_critical"));
    }
  });
  test("P7 Budget: issue/parallel capacity does not prevent a budgeted review agent", () => {
    const v = input(); v.run.issues.push({ number: 82, repair_rounds: 0 }); v.run.active_issues = [81];
    const r = budget(v); assert.equal(r.can_start_issue, false); assert.equal(r.can_start_agent, true);
    assert.deepEqual(r.repairable_issues, [81]);
    assert(r.reason_codes.includes("budget_issue_limit")); assert(r.reason_codes.includes("budget_parallel_limit"));
    v.run.active_agents = 3; assert.equal(budget(v).can_start_agent, false);
  });
  test("P7 Budget: repair holds are local, zero repairs is valid, overparallel is unsafe", () => {
    const v = input(); v.policy.limits.issues = 3; v.policy.limits.parallel_issues = 2;
    v.run.issues = [{ number: 82, repair_rounds: 0 }, { number: 81, repair_rounds: 2 }]; v.run.active_issues = [82];
    const r = budget(v); assert.equal(r.can_start_issue, true); assert.deepEqual(r.held_issues, [81]); assert.deepEqual(r.repairable_issues, [82]);
    v.policy.limits.repair_rounds = 0; assert.deepEqual(budget(v).held_issues, [81, 82]); assert.deepEqual(budget(v).repairable_issues, []);
    v.policy.limits.parallel_issues = 1; v.run.active_issues = [81, 82]; closed(budget(v));
  });
  test("P7 Budget: save window and low quota never propose a new repair cycle", () => {
    const v = input(); v.run.active_issues = [81]; v.now = at(50); assert.deepEqual(budget(v).repairable_issues, []);
    const q = observed(input()); q.run.active_issues = [81]; q.observation.windows[0].value = 30;
    assert.deepEqual(budget(q).repairable_issues, []);
  });
  test("P7 Budget: reports all applicable reasons in fixed order with checkpoint precedence", () => {
    const v = observed(input()); v.now = at(60); v.observation.observed_at = v.now; v.observation.windows[0].value = 15;
    for (const flag of ["stop_requested", "authorization_lost", "storage_failed", "work_unknown"]) v.run[flag] = true;
    v.run.issues = [{ number: 82, repair_rounds: 2 }, { number: 81, repair_rounds: 2 }]; v.run.active_issues = [82, 81]; v.run.active_agents = 3;
    const r = budget(v); closed(r); assert.deepEqual(r.held_issues, [81, 82]);
    assert.deepEqual(r.reason_codes, ["budget_stopped", "budget_authority_lost", "budget_storage_failed", "budget_work_unknown",
      "budget_deadline", "budget_save_window", "budget_quota_critical", "budget_quota_low", "budget_issue_limit",
      "budget_parallel_limit", "budget_agent_limit", "budget_repair_limit"]);
  });
  test("P7 Budget: serialization limit applies to otherwise shaped inputs without leaking values", () => {
    let small, large;
    for (let n = 0; n <= 63; n++) {
      const v = observed(input()), o = v.observation, ref = "\u0001".repeat(128);
      o.expected_scope.account_ref = o.expected_scope.workspace_ref = o.observed_scope.account_ref = o.observed_scope.workspace_ref = ref;
      o.expected_scope.window_ids = Array.from({ length: 16 }, (_, i) => "\u0001".repeat(n) + String.fromCharCode(65 + i));
      o.windows = o.expected_scope.window_ids.map(id => ({ id, metric: "remaining_percent", value: 80 }));
      if (Buffer.byteLength(JSON.stringify(v)) <= 16384) small = v; else { large = v; break; }
    }
    assert(small && large); assert.equal(budget(small).decision, "continue"); closed(budget(large));
  });
  test("P7 Budget: decision calls perform no IO, process, quota acquisition or clock reads", async () => {
    const names = ["node:fs", "node:http", "node:https", "node:net", "node:child_process"];
    const modules = await Promise.all(names.map(n => import(n)));
    const { syncBuiltinESMExports } = await import("node:module");
    const saved = [], calls = [], originalDate = Date, originalFetch = globalThis.fetch;
    const deny = () => { calls.push("forbidden"); throw Error("credential-sentinel"); };
    const v = freeze(input()); let result;
    try {
      for (const m of modules) for (const key of ["readFileSync", "writeFileSync", "openSync", "appendFileSync", "renameSync", "unlinkSync", "request", "get", "connect", "createConnection", "exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync", "fork"])
        if (typeof m.default[key] === "function") { saved.push([m.default, key, m.default[key]]); m.default[key] = deny; }
      globalThis.fetch = deny;
      globalThis.Date = class extends originalDate { constructor(...args) { if (!args.length) deny(); super(...args); } static now() { return deny(); } };
      syncBuiltinESMExports(); result = budget(v);
    } finally {
      for (const [object, key, value] of saved) object[key] = value;
      globalThis.Date = originalDate; globalThis.fetch = originalFetch; syncBuiltinESMExports();
    }
    assert.deepEqual(calls, []); assert.equal(result.decision, "continue");
  });
}

// authority.test.mjs
{
  function setup(intent = "continue") {
    const p = profile(),
      s = signedRequest(p, intent);
    const e = s.envelope;
    e.signature = sign(
      null,
      Buffer.from(
        "workflow-runner:v1:request\n" +
          canonical({ issuer: e.issuer, key_id: e.key_id, payload: e.payload }),
      ),
      s.privateKey,
    ).toString("base64");
    const a = createRunnerAuthority({
      mode: "synthetic",
      keys: [s.key],
      readSource: async () => s.source,
      clock: () => time,
    });
    return { p, s, a };
  }
  test("a current signed request and independently read human source produce an opaque ticket", async () => {
    const { p, s, a } = setup();
    const r = await verifyRequest(a, s.envelope, p);
    assert.equal(r.intent, "continue");
    assert.equal(r.authority, false);
    assert.ok(r.ticket);
    assert.deepEqual(JSON.parse(JSON.stringify(r.ticket)), {});
  });
  for (const fault of [
    "signature",
    "actor",
    "source",
    "edited",
    "bot",
    "permission",
    "expired",
  ])
    test("authority rejects " + fault, async () => {
      const { p, s, a } = setup();
      if (fault === "signature") s.envelope.signature = "A".repeat(88);
      if (fault === "actor") s.source.actor_id = 8;
      if (fault === "source") s.source.body_digest = "f".repeat(64);
      if (fault === "edited") s.source.updated_at = "2026-11-06T00:00:01Z";
      if (fault === "bot") s.source.actor_type = "Bot";
      if (fault === "permission") s.source.permission = "read";
      if (fault === "expired") {
        s.envelope.payload.expires_at = time;
      }
      await assert.rejects(verifyRequest(a, s.envelope, p));
    });
  test("JSON cannot reconstruct a host authority", async () => {
    const { p, s } = setup();
    await assert.rejects(verifyRequest({ approved: true }, s.envelope, p));
  });
  test("a simple human continuation is bound by the signed run and profile metadata", async () => {
    const { p, s } = setup();
    s.envelope.payload.source_digest = (
      await import("../../tools/workflow-runner/core.mjs")
    ).hash("進めてください");
    s.source.body_digest = s.envelope.payload.source_digest;
    const e = s.envelope;
    e.signature = sign(
      null,
      Buffer.from(
        "workflow-runner:v1:request\n" +
          canonical({ issuer: e.issuer, key_id: e.key_id, payload: e.payload }),
      ),
      s.privateKey,
    ).toString("base64");
    const a = createRunnerAuthority({
      mode: "synthetic",
      keys: [s.key],
      readSource: async () => s.source,
      clock: () => time,
    });
    assert.equal((await verifyRequest(a, e, p)).intent, "continue");
  });
  test("an expired issuer key never reaches the source reader", async () => {
    const { p, s } = setup();
    let reads = 0;
    const a = createRunnerAuthority({
      mode: "synthetic",
      keys: [{ ...s.key, expires_at: time }],
      readSource: async () => {
        reads++;
        return s.source;
      },
      clock: () => time,
    });
    await assert.rejects(verifyRequest(a, s.envelope, p));
    assert.equal(reads, 0);
  });
}

// cli.test.mjs
{
  test("CLI validation has no writer or credential discovery and refuses mutable commands", async () => {
    const root = mkdtempSync(join(tmpdir(), "runner-cli-"));
    try {
      const file = join(root, "p.json");
      writeFileSync(file, JSON.stringify(profile()));
      assert.equal(
        (
          await runCli([
            "check-profile",
            "--input",
            file,
            "--at",
            "2026-11-06T00:00:00Z",
            "--json",
          ])
        ).exitCode,
        0,
      );
      assert.equal((await runCli(["shell", "--input", file])).exitCode, 1);
      assert.equal(
        (await runCli(["check-profile", "--input", file, "--input", file]))
          .exitCode,
        1,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("a fixed local control socket forwards only a validated request to the host supervisor", async () => {
    const root = mkdtempSync(join(tmpdir(), "runner-control-"));
    chmodSync(root, 0o700);
    const socket = join(root, "control.sock");
    let calls = 0,
      server;
    try {
      server = await serveControl({
        socket,
        supervisor: {
          accept: async (request, resolve, options) => {
            calls++;
            assert.equal(options.wait, false);
            assert.equal(typeof resolve, "function");
            return {
              status: "running",
              mode: "synthetic",
              run_id: "run-1",
              not_evaluated: ["production"],
            };
          },
        },
        resolveTasks: async () => [],
      });
      const file = join(root, "r.json");
      writeFileSync(file, JSON.stringify(signedRequest().envelope));
      const r = await runCli([
        "control",
        "--socket",
        socket,
        "--input",
        file,
        "--json",
      ]);
      assert.equal(r.exitCode, 0);
      assert.equal(JSON.parse(r.output).status, "running");
      writeFileSync(
        file,
        JSON.stringify({ approved: true, command: "curl external" }),
      );
      assert.equal(
        (
          await runCli([
            "control",
            "--socket",
            socket,
            "--input",
            file,
            "--json",
          ])
        ).exitCode,
        1,
      );
      assert.equal(calls, 1);
    } finally {
      await server?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

// codex.test.mjs
{
  const rows = [
    {
      type: "thread.started",
      thread_id: "11111111-1111-1111-1111-111111111111",
    },
    {
      type: "item.completed",
      item: {
        id: "item-1",
        type: "agent_message",
        text: '{"status":"passed"}',
      },
    },
    { type: "turn.completed", usage: { input_tokens: 20, output_tokens: 10 } },
  ];
  test("Codex parser distinguishes an observed terminal event from a model summary", () => {
    const r = parseCodexEvents(rows.map((x) => JSON.stringify(x)).join("\n"));
    assert.equal(r.status, "completed");
    assert.equal(r.message, '{"status":"passed"}');
    assert.equal(r.provider_context_id, rows[0].thread_id);
  });
  for (const name of [
    "missing terminal",
    "duplicate context",
    "failure after success",
    "unknown usage",
    "oversized event",
  ])
    test("Codex parser rejects " + name, () => {
      const r = structuredClone(rows);
      if (name === "missing terminal") r.pop();
      if (name === "duplicate context") r.unshift(rows[0]);
      if (name === "failure after success")
        r.push({ type: "turn.failed", error: { message: "PRIVATE_CANARY" } });
      if (name === "unknown usage") delete r[2].usage;
      if (name === "oversized event") r[1].item.text = "a".repeat(1048577);
      assert.throws(() =>
        parseCodexEvents(r.map((x) => JSON.stringify(x)).join("\n")),
      );
    });
}

// docker.test.mjs
{
  test("worker container is bounded, networkless, nonroot and has only approved mounts", () => {
    const p = profile(),
      q = {
        attempt_id: "attempt-1",
        role: "implementation",
        profile: p,
        workspace: {
          source: "/tmp/source",
          mounts: [{ source: "/tmp/write", target: "/work/src", path: "src" }],
        },
        socket_directory: "/tmp/gate",
      };
    const a = dockerArgs(q);
    for (const v of [
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--memory=512m",
      "--pids-limit=64",
      "--cpus=1",
      "--init",
    ])
      assert.ok(a.includes(v), v);
    assert.ok(
      !a.some((x) => /docker.sock|--privileged|network=host|pid=host/.test(x)),
    );
    assert.ok(a.includes("type=bind,src=/tmp/source,dst=/work,readonly"));
    assert.ok(a.includes("type=bind,src=/tmp/write,dst=/work/src"));
    q.role = "review";
    const r = dockerArgs(q);
    assert.ok(r.includes("type=bind,src=/tmp/write,dst=/work/src,readonly"));
  });
  test("Docker args reject a scope escape or unpinned image", () => {
    const p = profile(),
      q = {
        attempt_id: "attempt-1",
        role: "implementation",
        profile: p,
        workspace: {
          source: "/tmp/source",
          mounts: [{ source: "/tmp/write", target: "/etc", path: "src" }],
        },
        socket_directory: "/tmp/gate",
      };
    assert.throws(() => dockerArgs(q));
    q.workspace.mounts = [];
    p.image = "node:latest";
    assert.throws(() => dockerArgs(q));
  });
}

// evidence.test.mjs
{
  function fixture() {
    const input = execution(),
      p = profile({ execution_profile_digest: hash(input.profile) }),
      claim = {
        claim_id: "claim-1",
        worker_id: "worker-1",
        generation: 1,
        run_id: "run-1",
        issue_number: 1,
        head_sha: "2".repeat(40),
      };
    const attempts = ["implementation", "verification", "review"].map(
      (role, i) => ({
        schema_version: 1,
        artifact_kind: "runner-attempt",
        attempt_id: "attempt-" + i,
        run_id: "run-1",
        claim_id: "claim-1",
        worker_id: "worker-1",
        generation: 1,
        issue_number: 1,
        role,
        context_id:
          role === "implementation"
            ? "impl-1"
            : role === "review"
              ? "review-1"
              : "verification-1",
        profile_digest: hash(p),
        head_sha: claim.head_sha,
        status: "completed",
        container_id: "synthetic-" + i,
        started_at: input.context.evaluated_at,
        updated_at: input.context.evaluated_at,
        stopped: true,
        artifact_digest: String(i + 1).repeat(64),
      }),
    );
    const artifact = (a, output) => {
      const content = {
        execution: {
          attempt_id: a.attempt_id,
          context_id: a.context_id,
          role: a.role,
          result: {
            status: "completed",
            stopped: true,
            context_id: a.context_id,
            output,
          },
        },
      };
      return { ...content, digest: hash(content) };
    };
    const artifacts = [
      artifact(attempts[0], {}),
      artifact(attempts[1], {
        exit_code: 0,
        test_count: 2,
        command: { executable: "node", argv: ["--test"] },
      }),
    ];
    attempts[0].artifact_digest = artifacts[0].digest;
    attempts[1].artifact_digest = artifacts[1].digest;
    input.verifications[0].log_refs = [
      { ...source("verification-log"), digest: attempts[1].artifact_digest },
    ];
    rebind(input);
    artifacts.push(
      artifact(attempts[2], { message: JSON.stringify(input.reviews[0]) }),
    );
    attempts[2].artifact_digest = artifacts[2].digest;
    input.reviews[0].evidence_refs = [
      { ...source("review-log"), digest: attempts[2].artifact_digest },
    ];
    rebind(input);
    return {
      input,
      attempts,
      claim,
      profile: p,
      now: input.context.evaluated_at,
      artifacts,
    };
  }
  test("P1 validates complete evidence tied to three actually completed attempt records", () => {
    const f = fixture();
    assert.equal(checkRunnerEvidence(f).status, "passed");
  });
  for (const fault of [
    "invented test count",
    "different command",
    "invented review findings",
    "missing actual logs",
  ])
    test("P1 cannot accept " + fault, () => {
      const f = fixture();
      if (fault === "invented test count")
        f.input.verifications[0].test_count = 100;
      if (fault === "different command")
        f.artifacts[1].execution.result.output.command.argv = ["--version"];
      if (fault === "invented review findings")
        f.artifacts[2].execution.result.output.message =
          "Synthetic CLI output without a review";
      if (fault === "missing actual logs") f.artifacts = [];
      rebind(f.input);
      assert.throws(() => checkRunnerEvidence(f));
    });
  for (const fault of [
    "other issue",
    "other worker",
    "old generation",
    "missing log",
    "same context",
  ])
    test("P1 evidence cannot borrow " + fault, () => {
      const f = fixture();
      if (fault === "other issue") f.attempts[2].issue_number = 2;
      if (fault === "other worker") f.attempts[2].worker_id = "other";
      if (fault === "old generation") f.attempts[2].generation = 2;
      if (fault === "missing log")
        f.input.verifications[0].log_refs = [source("unrelated")];
      if (fault === "same context") f.attempts[2].context_id = "impl-1";
      let passed = false;
      try {
        passed = checkRunnerEvidence(f).status === "passed";
      } catch {}
      assert.equal(passed, false);
    });
}

// gateway.test.mjs
{
  function fixture() {
    const p = profile();
    p.limits.cost_microusd = 100000;
    let reserved = 0,
      settled = 0,
      sent = 0;
    const ledger = {
      async reserveUsage() {
        reserved++;
        return {};
      },
      async settleUsage() {
        settled++;
        return {};
      },
    };
    const gateway = createGateway({
      mode: "synthetic",
      profile: p,
      ledger,
      clock: () => time,
      observeAttempt: async () => ({
        active: true,
        stopped: false,
        attempt_id: "attempt-1",
        run_id: "run-1",
        epoch: 1,
      }),
      upstream: async (request) => {
        sent++;
        return {
          status: 200,
          body: JSON.stringify({
            id: "response-1",
            usage: { input_tokens: 30, output_tokens: 10 },
            output: [],
          }),
          content_type: "application/json",
        };
      },
    });
    return { p, gateway, counts: () => ({ reserved, settled, sent }) };
  }
  test("gateway reserves before sending and uses provider usage for settlement", async () => {
    const s = fixture();
    const r = await s.gateway.request(
      {
        method: "POST",
        path: "/v1/responses",
        body: {
          model: s.p.model.id,
          input: "Synthetic",
          max_output_tokens: 100,
          stream: false,
        },
      },
      "attempt-1",
    );
    assert.equal(r.status, 200);
    assert.deepEqual(s.counts(), { reserved: 1, settled: 1, sent: 1 });
  });
  for (const [name, change] of [
    ["other route", (r) => (r.path = "/v1/files")],
    ["query", (r) => (r.path += "?x=1")],
    ["different model", (r) => (r.body.model = "other")],
    ["excess output", (r) => (r.body.max_output_tokens = 2000)],
    ["remote tool", (r) => (r.body.tools = [{ type: "web_search" }])],
    [
      "URL input",
      (r) =>
        (r.body.input = [
          { type: "input_file", file_url: "https://example.invalid/private" },
        ]),
    ],
  ])
    test("gateway blocks " + name + " before upstream", async () => {
      const s = fixture(),
        q = {
          method: "POST",
          path: "/v1/responses",
          body: {
            model: s.p.model.id,
            input: "Synthetic",
            max_output_tokens: 100,
          },
        };
      change(q);
      await assert.rejects(s.gateway.request(q, "attempt-1"));
      assert.equal(s.counts().sent, 0);
    });
  test("missing usage holds a reservation and blocks further model calls", async () => {
    const s = fixture();
    const gateway = createGateway({
      mode: "synthetic",
      profile: s.p,
      clock: () => time,
      ledger: {
        reserveUsage: async () => ({}),
        settleUsage: async () => assert.fail(),
      },
      observeAttempt: async () => ({
        active: true,
        stopped: false,
        attempt_id: "attempt-1",
        run_id: "run-1",
        epoch: 1,
      }),
      upstream: async () => ({
        status: 200,
        body: "{}",
        content_type: "application/json",
      }),
    });
    await assert.rejects(
      gateway.request(
        {
          method: "POST",
          path: "/v1/responses",
          body: { model: s.p.model.id, input: "Synthetic" },
        },
        "attempt-1",
      ),
    );
    await assert.rejects(
      gateway.request(
        {
          method: "POST",
          path: "/v1/responses",
          body: { model: s.p.model.id, input: "Synthetic" },
        },
        "attempt-1",
      ),
    );
  });
  test("mutating the caller profile cannot broaden an existing gateway", async () => {
    const s = fixture();
    s.p.limits.max_output_tokens = 2000;
    await assert.rejects(
      s.gateway.request(
        {
          method: "POST",
          path: "/v1/responses",
          body: {
            model: s.p.model.id,
            input: "Synthetic",
            max_output_tokens: 1500,
          },
        },
        "attempt-1",
      ),
    );
    assert.equal(s.counts().sent, 0);
  });
}

// ledger.test.mjs
{
  function setup() {
    const directory = mkdtempSync(join(tmpdir(), "runner-ledger-"));
    chmodSync(directory, 0o700);
    const p = profile();
    return {
      directory,
      p,
      clean() {
        rmSync(directory, { recursive: true, force: true });
      },
    };
  }
  const admission = (p, intent = "continue") => ({
    event_id: "event-" + intent,
    nonce: "nonce-" + intent,
    run_id: "run-1",
    intent,
    request_digest: hash({ intent }),
    now: time,
  });
  const attempt = (n = 1) => ({
    attempt_id: "attempt-" + n,
    run_id: "run-1",
    claim_id: "claim-" + n,
    worker_id: "worker-" + n,
    generation: 1,
    issue_number: n,
    role: "implementation",
    context_id: "context-" + n,
    head_sha: "1".repeat(40),
    now: time,
  });
  async function init(s) {
    const l = await openLedger({ directory: s.directory, profile: s.p });
    await l.admit(admission(s.p));
    return l;
  }
  test("attempt reservation is atomic, idempotent, capped and rejects changed replay", async () => {
    const s = setup();
    let l;
    try {
      l = await init(s);
      const q = attempt();
      const r = await Promise.allSettled([
        l.reserve(q),
        l.reserve({ ...q, attempt_id: "other" }),
      ]);
      assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
      const c = r.find((x) => x.status === "fulfilled").value;
      assert.equal(
        (await l.reserve({ ...q, attempt_id: c.attempt_id })).attempt_id,
        c.attempt_id,
      );
      await assert.rejects(
        l.reserve({ ...q, attempt_id: c.attempt_id, worker_id: "changed" }),
      );
      await l.reserve(attempt(2));
      await l.reserve(attempt(3));
      await assert.rejects(l.reserve(attempt(4)));
    } finally {
      await l?.close();
      s.clean();
    }
  });
  test("second writer, unsafe directory and old generation cannot mutate", async () => {
    const s = setup();
    let l;
    try {
      l = await init(s);
      await assert.rejects(
        openLedger({ directory: s.directory, profile: s.p }),
      );
      const a = await l.reserve(attempt());
      await assert.rejects(
        l.observe({
          attempt_id: a.attempt_id,
          epoch: 0,
          status: "running",
          container_id: "fake-1",
          stopped: false,
          artifact_digest: null,
          now: time,
        }),
      );
    } finally {
      await l?.close();
      s.clean();
    }
  });
  test("stop fences requests while retaining live attempt and budget", async () => {
    const s = setup();
    let l;
    try {
      l = await init(s);
      await l.reserve(attempt());
      await l.admit(admission(s.p, "stop"));
      await assert.rejects(l.reserve(attempt(2)));
      const v = await l.view();
      assert.equal(v.attempts.length, 1);
      assert.equal(v.runs[0].stopped, true);
    } finally {
      await l?.close();
      s.clean();
    }
  });
  test("restart creates a recovery barrier instead of starting another worker", async () => {
    const s = setup();
    let l;
    try {
      l = await init(s);
      const a = await l.reserve(attempt());
      await l.close();
      l = await openLedger({ directory: s.directory, profile: s.p });
      const v = await l.view();
      assert.equal(v.recovery_required, true);
      assert.ok(v.epoch > a.epoch);
      await assert.rejects(l.reserve(attempt(2)));
    } finally {
      await l?.close();
      s.clean();
    }
  });
  test("unconfirmed model usage retains worst-case reservation after restart", async () => {
    const s = setup();
    s.p.limits.cost_microusd = 50000;
    let l;
    try {
      l = await init(s);
      const a = await l.reserve(attempt());
      const q = {
        request_id: "request-1",
        attempt_id: a.attempt_id,
        epoch: a.epoch,
        input_digest: "e".repeat(64),
        now: time,
      };
      const u = await l.reserveUsage(q);
      assert.ok(u.reserved_microusd > 0);
      await l.close();
      l = await openLedger({ directory: s.directory, profile: s.p });
      const v = await l.view();
      assert.equal(v.recovery_required, true);
      assert.equal(v.usage[0].status, "unknown");
      assert.equal(v.runs[0].spent, u.reserved_microusd);
      await assert.rejects(
        l.reserveUsage({ ...q, request_id: "request-2", epoch: v.epoch }),
      );
    } finally {
      await l?.close();
      s.clean();
    }
  });
  test("zero model budget prevents a request before any send", async () => {
    const s = setup();
    let l;
    try {
      l = await init(s);
      const a = await l.reserve(attempt());
      await assert.rejects(
        l.reserveUsage({
          request_id: "no-budget",
          attempt_id: a.attempt_id,
          epoch: a.epoch,
          input_digest: "f".repeat(64),
          now: time,
        }),
      );
      assert.deepEqual((await l.view()).usage, []);
    } finally {
      await l?.close();
      s.clean();
    }
  });
}

// native-request.test.mjs
{
  function transport(body = "進めてください", type = "User") {
    return {
      async request(q) {
        if (q.path === "/repos/example/synthetic")
          return { status: 200, headers: {}, body: { id: 1 } };
        if (q.path.endsWith("/issues/comments/123"))
          return {
            status: 200,
            headers: {},
            body: {
              id: 123,
              user: { id: 7, login: "gorillaimo", type },
              body,
              updated_at: time,
              issue_url:
                "https://api.github.com/repos/example/synthetic/issues/1",
              performed_via_github_app: null,
            },
          };
        return {
          status: 200,
          headers: {},
          body: { user: { id: 7, login: "gorillaimo" }, permission: "admin" },
        };
      },
    };
  }
  test("a read-back native human request is signed once with stable event/nonce identity", async () => {
    const p = profile(),
      pair = generateKeyPairSync("ed25519"),
      reader = createGitHubRequestReader({
        transport: transport(),
        mode: "synthetic",
        clock: () => time,
      }),
      issuer = createGitHubRequestIssuer({
        mode: "synthetic",
        issuer: "test-issuer",
        key_id: "key-1",
        private_key: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
        reader,
        clock: () => time,
      });
    const a = await issuer.issue({
        profile: p,
        source_id: "123",
        run_id: "run-1",
        intent: "continue",
      }),
      b = await issuer.issue({
        profile: p,
        source_id: "123",
        run_id: "run-1",
        intent: "continue",
      });
    assert.equal(a.payload.nonce, b.payload.nonce);
    const authority = createRunnerAuthority({
      mode: "synthetic",
      keys: [
        {
          issuer: "test-issuer",
          key_id: "key-1",
          public_key: pair.publicKey.export({ type: "spki", format: "pem" }),
          expires_at: "2026-11-07T00:00:00Z",
        },
      ],
      readSource: reader,
      clock: () => time,
    });
    assert.equal((await verifyRequest(authority, a, p)).intent, "continue");
  });
  test("native source reader rejects bot intent and a quoted command", async () => {
    for (const [body, type] of [
      ["進めてください", "Bot"],
      ["> 進めてください", "User"],
    ]) {
      const p = profile(),
        pair = generateKeyPairSync("ed25519"),
        reader = createGitHubRequestReader({
          transport: transport(body, type),
          mode: "synthetic",
          clock: () => time,
        }),
        issuer = createGitHubRequestIssuer({
          mode: "synthetic",
          issuer: "test-issuer",
          key_id: "key-1",
          private_key: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
          reader,
          clock: () => time,
        });
      await assert.rejects(
        issuer.issue({
          profile: p,
          source_id: "123",
          run_id: "run-1",
          intent: "continue",
        }),
      );
    }
  });
  test("a recreated repository coordinate cannot impersonate the configured numeric repository ID", async () => {
    const reader = createGitHubRequestReader({
      transport: transport(),
      mode: "synthetic",
      clock: () => time,
    });
    await assert.rejects(
      reader({
        repository: "example/synthetic",
        repository_id: 2,
        source_id: "123",
      }),
    );
  });
}

// profile.test.mjs
{
  test("profile pins finite resource, model, image and execution bounds", () => {
    assert.equal(checkProfile(profile(), time).status, "passed");
  });
  for (const [name, change] of [
    ["unknown field", (p) => (p.extra = true)],
    ["worker cap", (p) => (p.limits.max_ai_workers = 4)],
    ["unlimited cost", (p) => (p.limits.cost_microusd = -1)],
    ["mutable image", (p) => (p.image = "node:latest")],
    ["wrong endpoint", (p) => (p.model.endpoint = "https://example.invalid")],
    ["expired price", (p) => (p.model.pricing_expires_at = time)],
    ["git path", (p) => (p.write_paths = ["src/.git"])],
    ["forbidden overlap", (p) => (p.forbidden_paths = ["src/key"])],
    ["broaden send scope", (p) => (p.send_paths = ["other"])],
    ["overlapping writable roots", (p) => (p.write_paths = ["src", "src/a"])],
  ])
    test("profile rejects " + name, () => {
      const p = profile();
      change(p);
      assert.equal(checkProfile(p, time).status, "blocked");
    });
  test("data accessors never run or leak into diagnostics", () => {
    const p = profile();
    let touched = false;
    Object.defineProperty(p, "extra", {
      enumerable: true,
      get() {
        touched = true;
        throw Error("PRIVATE_CANARY");
      },
    });
    const r = checkProfile(p, time);
    assert.equal(touched, false);
    assert.ok(!JSON.stringify(r).includes("PRIVATE_CANARY"));
    assert.equal(r.status, "blocked");
  });
  test("proxy traps are never evaluated as profile data", () => {
    let touched = false;
    const p = new Proxy(profile(), {
      getPrototypeOf() {
        touched = true;
        throw Error("PRIVATE_CANARY");
      },
    });
    assert.equal(checkProfile(p, time).status, "blocked");
    assert.equal(touched, false);
  });
}

// supervisor.test.mjs
{
  async function fixture(options = {}) {
    const directory = mkdtempSync(join(tmpdir(), "runner-supervisor-"));
    chmodSync(directory, 0o700);
    const execution_profile = (
      await import("../workflow-execution/fixture.mjs")
    ).fixture().profile;
    const p = profile({ execution_profile_digest: hash(execution_profile) }),
      claim = {
        claim_id: "claim-1",
        worker_id: "worker-1",
        generation: 1,
        issue_number: 1,
        run_id: "run-1",
        profile_digest: p.execution_profile_digest,
        policy_digest: options.policyDigest ?? p.policy_digest,
        stages: options.stages ?? ["implementation", "validation"],
        allowed_paths: ["src", "tests"],
        forbidden_paths: ["secrets"],
        head_sha: "2".repeat(40),
        status: "ready",
        human_owner: "gorillaimo",
      },
      handle = Object.freeze({});
    const secondClaim = {
        ...claim,
        claim_id: "claim-2",
        worker_id: "worker-2",
        issue_number: 2,
        allowed_paths: ["tests"],
      },
      secondHandle = Object.freeze({});
    if (options.two) claim.allowed_paths = ["src"];
    let starts = 0,
      stops = 0;
    const calls = [];
    const s = signedRequest(p);
    let requestSequence = 0,
      currentSourceDigest = null;
    const request = (intent) => {
      const suffix = options.fresh ? "-" + ++requestSequence : "";
      const r = signedRequest(p, intent, {
        event_id: "event-" + intent + suffix,
        nonce: "nonce-" + intent + suffix,
      });
      r.envelope.issuer = s.envelope.issuer;
      r.envelope.key_id = s.envelope.key_id;
      r.envelope.signature = sign(
        null,
        Buffer.from(
          "workflow-runner:v1:request\n" +
            canonical({
              issuer: r.envelope.issuer,
              key_id: r.envelope.key_id,
              payload: r.envelope.payload,
            }),
        ),
        s.privateKey,
      ).toString("base64");
      currentSourceDigest = r.envelope.payload.source_digest;
      return r.envelope;
    };
    const authority = createRunnerAuthority({
      mode: "synthetic",
      keys: [s.key],
      clock: () => time,
      readSource: async ({ source_id }) => ({
        ...s.source,
        body_digest:
          currentSourceDigest ??
          hash(
            "workflow " +
              currentIntent +
              " run-1 " +
              hash(p) +
              " nonce-" +
              currentIntent,
          ),
      }),
    });
    let currentIntent = "continue";
    const adapter = createSyntheticAdapter({
      probe: async () => ({
        schema_version: 1,
        artifact_kind: "runner-capability",
        adapter_id: p.adapter_id,
        adapter_digest: ADAPTER_DIGEST,
        image: p.image,
        mode: "synthetic",
        observed_at: time,
        checks: Object.fromEntries(
          [
            "version",
            "noninteractive",
            "structured_output",
            "isolated_write",
            "network_none",
            "credential_separation",
            "resource_limits",
            "stop_tree",
            "resume",
            "usage",
            "model_gateway",
          ].map((k) => [k, options.missing !== k]),
        ),
        evidence_digest: "a".repeat(64),
      }),
      async start(q) {
        starts++;
        calls.push(q.role);
        await q.onCreated("synthetic-" + starts);
        await options.startWait?.();
        return {
          n: starts,
          role: q.role,
          context_id: q.context_id,
          claim_id: q.attempt.claim_id,
        };
      },
      async observe(h) {
        await options.wait?.(h);
        return {
          status:
            options.failed ||
            (options.failFirst && h.claim_id === "claim-1") ||
            (options.verificationFailed && h.role === "verification")
              ? "failed"
              : "completed",
          stopped: true,
          context_id: h.context_id,
          artifact_digest: "e".repeat(64),
          output:
            h.role === "verification"
              ? { exit_code: options.verificationFailed ? 1 : 0, test_count: 1 }
              : {},
        };
      },
      async recoverStop(record, { workspace }) {
        return options.recover
          ? options.recover(record, workspace)
          : { stopped: true, resume_token: Object.freeze({}) };
      },
      async resume(q) {
        return this.start(q);
      },
      async stop() {
        stops++;
        return { stopped: true };
      },
    });
    const dispatcher = {
      inspect: async () => ({
        status: "ready",
        generation: 1,
        claims: options.two ? [claim, secondClaim] : [claim],
      }),
      handoff: async (h) => ({
        status:
          h === handle || (options.two && h === secondHandle)
            ? "ready"
            : "blocked",
      }),
      stop: async () => {},
    };
    await options.seed?.({ directory, p, claim });
    const supervisor = await openSupervisor({
      directory,
      profile: p,
      authority,
      adapter,
      dispatcher,
      mode: "synthetic",
      clock: () => time,
      prepareTask: async ({ attempt, claim: current }) => {
        const d = join(directory, attempt.attempt_id);
        mkdirSync(d, { mode: 0o700 });
        return {
          workspace: prepareWorkspace({
            directory: d,
            profile: options.two
              ? { ...p, write_paths: current.allowed_paths }
              : p,
            files: [
              {
                path:
                  (options.two && current.issue_number === 2
                    ? "tests"
                    : "src") + "/main.js",
                content: "Synthetic",
              },
            ],
          }),
          prompt: "Synthetic task",
          execution_profile,
          command_id: "unit",
        };
      },
      evaluate: async ({ attempts }) =>
        (typeof options.evidence === "function"
          ? options.evidence({ attempts })
          : options.evidence) ?? {
          status: "blocked",
          diagnostics: ["evidence_not_evaluated"],
        },
    });
    return {
      p,
      supervisor,
      claim,
      handle,
      directory,
      calls,
      get starts() {
        return starts;
      },
      get stops() {
        return stops;
      },
      async accept(intent = "continue") {
        currentIntent = intent;
        return supervisor.accept(request(intent), [
          { claim_id: claim.claim_id, handle },
          ...(options.two
            ? [{ claim_id: secondClaim.claim_id, handle: secondHandle }]
            : []),
        ]);
      },
      async close() {
        await supervisor.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  }
  test("a Runner profile cannot substitute a different GitHub policy", async () => {
    const s = await fixture({ policyDigest: "f".repeat(64) });
    try {
      const r = await s.accept();
      assert.equal(r.status, "blocked");
      assert.equal(s.starts, 0);
    } finally {
      await s.close();
    }
  });
  test("a stopped worker with unknown provider usage cannot release its P4 execution claim", async () => {
    const s = await fixture({
      seed: async ({ directory, p, claim }) => {
        p.limits.cost_microusd = 50000;
        const l = await openLedger({ directory, profile: p });
        try {
          await l.admit({
            event_id: "old-event",
            nonce: "old-nonce",
            run_id: "run-1",
            intent: "continue",
            request_digest: "a".repeat(64),
            now: time,
          });
          const a = await l.reserve({
            attempt_id: "old-attempt",
            run_id: "run-1",
            claim_id: claim.claim_id,
            worker_id: claim.worker_id,
            generation: claim.generation,
            issue_number: claim.issue_number,
            role: "implementation",
            context_id: "old-context",
            head_sha: claim.head_sha,
            now: time,
          });
          await l.reserveUsage({
            request_id: "old-request",
            attempt_id: a.attempt_id,
            epoch: a.epoch,
            input_digest: "b".repeat(64),
            now: time,
          });
          const content = {
              files: [],
              bytes: 0,
              source_digest: hash([]),
              execution: {
                attempt_id: a.attempt_id,
                context_id: a.context_id,
                role: a.role,
                result: null,
              },
            },
            digest = hash(content);
          writeFileSync(
            join(directory, a.attempt_id + ".artifact.json"),
            JSON.stringify({ ...content, digest }),
            { mode: 0o600 },
          );
          await l.observe({
            attempt_id: a.attempt_id,
            epoch: a.epoch,
            status: "stopped",
            container_id: null,
            stopped: true,
            artifact_digest: digest,
            now: time,
          });
        } finally {
          await l.close();
        }
      },
    });
    try {
      const r = await s.supervisor.workerEvidence({
        claim: s.claim,
        binding_digest: "c".repeat(64),
      });
      assert.equal(r.worker_stopped, false);
      assert.equal(r.release_confirmed, false);
    } finally {
      await s.close();
    }
  });
  test("missing adapter capability refuses startup and retains the claim", async () => {
    const s = await fixture({ missing: "stop_tree" });
    try {
      const r = await s.accept();
      assert.equal(r.status, "blocked");
      assert.equal(s.starts, 0);
    } finally {
      await s.close();
    }
  });
  test("status is read-only and does not create a run or start a worker", async () => {
    const s = await fixture();
    try {
      const before = await s.supervisor.inspect();
      await s.accept("status");
      const after = await s.supervisor.inspect();
      assert.deepEqual(after, before);
      assert.equal(s.starts, 0);
    } finally {
      await s.close();
    }
  });
  test("a forged P4 handle cannot start a worker", async () => {
    const s = await fixture();
    try {
      const r = await s.supervisor.accept((await signedRequest(s.p)).envelope, [
        { claim_id: "claim-1", handle: {} },
      ]);
      assert.equal(r.status, "blocked");
      assert.equal(s.starts, 0);
    } finally {
      await s.close();
    }
  });
  test("the pipeline runs implementation, a verification attempt and separate review but does not invent success", async () => {
    const s = await fixture();
    try {
      const r = await s.accept();
      assert.equal(r.status, "blocked");
      assert.deepEqual(s.calls, ["implementation", "verification", "review"]);
      const v = await s.supervisor.inspect();
      assert.equal(v.attempts.length, 3);
      assert.equal(new Set(v.attempts.map((a) => a.context_id)).size, 3);
      assert.ok(v.attempts.every((a) => a.stopped));
    } finally {
      await s.close();
    }
  });
  for (const stages of [["validation"], ["design"], ["implementation"], []])
    test(
      "a partial stage grant never starts an unapproved pipeline: " +
        stages.join(),
      async () => {
        const s = await fixture({ stages });
        try {
          const r = await s.accept();
          assert.equal(r.status, "blocked");
          assert.equal(s.starts, 0);
        } finally {
          await s.close();
        }
      },
    );
  test("a known failed verification reaches repair evaluation and stops on no progress", async () => {
    let evaluations = 0;
    const input = execution();
    input.context.evaluated_at = time;
    const s = await fixture({
      verificationFailed: true,
      evidence: () => {
        evaluations++;
        return { input, repairable: true, workflow_status: "running" };
      },
    });
    try {
      const r = await s.accept();
      assert.equal(r.status, "blocked");
      assert.equal(evaluations, 2);
      assert.deepEqual(s.calls, [
        "implementation",
        "verification",
        "review",
        "implementation",
        "verification",
        "review",
      ]);
      assert.ok(r.diagnostics.includes("repair_no_progress"));
    } finally {
      await s.close();
    }
  });
  test("an existing failed workflow cannot be repaired without renewed authorization", async () => {
    const input = execution();
    input.context.evaluated_at = time;
    const s = await fixture({
      verificationFailed: true,
      evidence: { input, repairable: true, workflow_status: "failed" },
    });
    try {
      const r = await s.accept();
      assert.equal(r.status, "blocked");
      assert.equal(s.starts, 3);
    } finally {
      await s.close();
    }
  });
  async function interrupted({ directory, p, claim }) {
    const l = await openLedger({ directory, profile: p });
    await l.admit({
      event_id: "old-event",
      nonce: "old-nonce",
      run_id: "run-1",
      intent: "continue",
      request_digest: "a".repeat(64),
      now: time,
    });
    const a = await l.reserve({
      attempt_id: "old-attempt",
      run_id: "run-1",
      claim_id: claim.claim_id,
      worker_id: claim.worker_id,
      generation: claim.generation,
      issue_number: claim.issue_number,
      role: "implementation",
      context_id: "old-context",
      head_sha: claim.head_sha,
      now: time,
    });
    const d = join(directory, "old-workspace");
    mkdirSync(d, { mode: 0o700 });
    const w = prepareWorkspace({
      directory: d,
      profile: p,
      files: [{ path: "src/main.js", content: "unpublished" }],
    });
    writeFileSync(
      join(directory, "old-attempt.workspace.json"),
      JSON.stringify({
        profile_digest: hash(p),
        directory: d,
        read_files_digest: w.read_files_digest,
      }),
      { mode: 0o600 },
    );
    await l.observe({
      attempt_id: a.attempt_id,
      epoch: a.epoch,
      status: "running",
      container_id: "synthetic-old",
      stopped: false,
      artifact_digest: null,
      now: time,
    });
    await l.close();
  }
  test("recovery stops and preserves the previous worker before allowing a fresh continuation", async () => {
    let recovered = 0;
    const s = await fixture({
      seed: interrupted,
      fresh: true,
      recover: async (a, w) => {
        recovered++;
        assert.equal(a.attempt_id, "old-attempt");
        assert.ok(w);
        return { stopped: true, resume_token: Object.freeze({}) };
      },
    });
    try {
      assert.equal((await s.accept()).status, "blocked");
      assert.equal(s.starts, 0);
      const r = await s.supervisor.reconcile([
        { claim_id: s.claim.claim_id, handle: s.handle },
      ]);
      assert.equal(r.status, "passed");
      assert.equal(recovered, 1);
      const v = await s.supervisor.inspect();
      assert.equal(v.recovery_required, false);
      assert.equal(v.attempts[0].stopped, true);
      assert.ok(v.attempts[0].artifact_digest);
      await s.accept();
      assert.equal(s.starts, 3);
    } finally {
      await s.close();
    }
  });
  test("an unconfirmed recovered process keeps the restart barrier and cannot start new workers", async () => {
    const s = await fixture({
      seed: interrupted,
      recover: async () => ({ stopped: false }),
    });
    try {
      const r = await s.supervisor.reconcile([
        { claim_id: s.claim.claim_id, handle: s.handle },
      ]);
      assert.equal(r.status, "blocked");
      assert.equal((await s.supervisor.inspect()).recovery_required, true);
      await s.accept();
      assert.equal(s.starts, 0);
    } finally {
      await s.close();
    }
  });
  test("replaying an already completed continuation never starts another pipeline", async () => {
    const s = await fixture();
    try {
      const first = await s.accept();
      const count = s.starts;
      const again = await s.accept();
      assert.equal(again.status, first.status);
      assert.equal(s.starts, count);
    } finally {
      await s.close();
    }
  });
  test("two independent claims can run together and one failure retains the other claim's progress", async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const s = await fixture({ two: true, failFirst: true, wait: () => gate });
    try {
      const pending = s.accept();
      for (let i = 0; i < 50 && s.starts < 2; i++)
        await new Promise((r) => setTimeout(r, 5));
      const started = s.starts;
      release();
      const result = await pending;
      assert.equal(started, 2);
      assert.equal(result.status, "blocked");
      const attempts = (await s.supervisor.inspect()).attempts;
      assert.equal(attempts.filter((a) => a.claim_id === "claim-2").length, 3);
      assert.ok(attempts.every((a) => a.stopped));
    } finally {
      release();
      await s.close();
    }
  });
  test("a second continue during an active attempt never starts a duplicate", async () => {
    let release;
    const wait = new Promise((r) => (release = r));
    const s = await fixture({ wait: () => wait });
    try {
      const first = s.accept();
      while (!s.starts) await new Promise((r) => setTimeout(r, 5));
      const second = await s.accept();
      assert.equal(second.status, "running");
      assert.equal(s.starts, 1);
      release();
      await first;
    } finally {
      release();
      await s.close();
    }
  });
  test("stop cannot report completion while a worker startup is still pending", async () => {
    let releaseStart, releaseObserve;
    const startup = new Promise((r) => (releaseStart = r)),
      observing = new Promise((r) => (releaseObserve = r));
    const s = await fixture({
      startWait: () => startup,
      wait: () => observing,
    });
    try {
      const work = s.accept();
      while (!s.starts) await new Promise((r) => setTimeout(r, 5));
      let done = false;
      const stopping = s.accept("stop").then((r) => {
        done = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 30));
      const premature = done;
      releaseStart();
      const stopped = await stopping;
      releaseObserve();
      await work;
      assert.equal(premature, false);
      assert.equal(stopped.status, "stopped");
      assert.ok(s.stops >= 1);
    } finally {
      releaseStart();
      releaseObserve();
      await s.close();
    }
  });
  test("stop wins over a pending worker and prevents subsequent review calls", async () => {
    let release;
    const wait = new Promise((r) => (release = r));
    const s = await fixture({ wait: () => wait });
    try {
      const first = s.accept();
      while (!s.starts) await new Promise((r) => setTimeout(r, 5));
      const stopped = await s.accept("stop");
      assert.equal(stopped.status, "stopped");
      assert.ok(s.stops >= 1);
      release();
      assert.equal((await first).status, "stopped");
      assert.equal(s.starts, 1);
    } finally {
      release();
      await s.close();
    }
  });
}

// workspace.test.mjs
{
  test("workspace stages only approved readable/sendable files and separate writable roots", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-work-"));
    try {
      const w = prepareWorkspace({
        directory: root,
        profile: profile(),
        files: [
          { path: "src/main.js", content: "before" },
          { path: "AGENTS.md", content: "rules" },
        ],
      });
      assert.equal(w.mounts.length, 2);
      writeFileSync(join(w.mounts[0].source, "main.js"), "after");
      const r = collectArtifacts(w);
      assert.equal(
        r.files.find((f) => f.path === "src/main.js").content,
        "after",
      );
      assert.match(r.digest, /^[a-f0-9]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  for (const path of [
    "../escape",
    "src/.git/config",
    "secrets/key",
    ".codex/config.toml",
  ])
    test("staging rejects " + path, () => {
      const root = mkdtempSync(join(tmpdir(), "runner-work-"));
      try {
        assert.throws(() =>
          prepareWorkspace({
            directory: root,
            profile: profile(),
            files: [{ path, content: "PRIVATE_CANARY" }],
          }),
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  test("result collection refuses links instead of following them to host data", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-work-"));
    try {
      const w = prepareWorkspace({
        directory: root,
        profile: profile(),
        files: [{ path: "src/main.js", content: "before" }],
      });
      symlinkSync("/etc/passwd", join(w.mounts[0].source, "escape"));
      assert.throws(() => collectArtifacts(w));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("protected workspace metadata restores unpushed content after a restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "runner-work-"));
    try {
      const p = profile(),
        w = prepareWorkspace({
          directory: root,
          profile: p,
          files: [{ path: "src/main.js", content: "before" }],
        });
      writeFileSync(join(w.mounts[0].source, "main.js"), "after");
      const { restoreWorkspace } = await import(
        "../../tools/workflow-runner/workspace.mjs"
      );
      const restored = restoreWorkspace({ directory: root, profile: p });
      assert.equal(collectArtifacts(restored).files[0].content, "after");
      assert.throws(() =>
        restoreWorkspace({
          directory: root,
          profile: { ...p, repository_id: 2 },
        }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
// A reviewer must not be allocated to an implementation's registered context.
{
  test("the atomic ledger rejects a reused context even under another role", async () => {
    const directory = mkdtempSync(join(tmpdir(), "runner-context-"));
    chmodSync(directory, 0o700);
    const p = profile();
    let l;
    try {
      l = await openLedger({ directory, profile: p });
      await l.admit({
        event_id: "event-1",
        nonce: "nonce-1",
        run_id: "run-1",
        intent: "continue",
        request_digest: "a".repeat(64),
        now: time,
      });
      const q = {
        attempt_id: "first",
        run_id: "run-1",
        claim_id: "claim-1",
        worker_id: "worker-1",
        generation: 1,
        issue_number: 1,
        role: "implementation",
        context_id: "one-context",
        head_sha: "1".repeat(40),
        now: time,
      };
      await l.reserve(q);
      await assert.rejects(
        l.reserve({ ...q, attempt_id: "review", role: "review" }),
      );
    } finally {
      await l?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
// Real process/SQLite boundaries; no provider, credentials or worker are used.
{
  const { spawn } = await import("node:child_process"),
    { once } = await import("node:events"),
    { createInterface } = await import("node:readline"),
    { existsSync } = await import("node:fs");
  async function backend(directory, p) {
    const child = spawn(
      "python3",
      [
        new URL("../../tools/workflow-runner/ledger_server.py", import.meta.url)
          .pathname,
        directory,
        new URL("../../", import.meta.url).pathname,
      ],
      {
        env: {
          PATH: "/usr/local/bin:/usr/bin:/bin",
          LANG: "C.UTF-8",
          PYTHONNOUSERSITE: "1",
          PYTHONDONTWRITEBYTECODE: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let next = 0;
    const pending = new Map(),
      lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const r = JSON.parse(line),
        q = pending.get(r.id);
      if (q) {
        pending.delete(r.id);
        r.ok ? q.resolve(r.value) : q.reject(new Error("backend rejected"));
      }
    });
    child.on("exit", () => {
      for (const q of pending.values()) q.reject(new Error("backend stopped"));
      pending.clear();
      lines.close();
    });
    child.stderr.resume();
    const rpc = (command, data, id = ++next) =>
      new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ id, command, data }) + "\n");
      });
    await rpc("initialize", { profile_digest: hash(p), profile: p }, 0);
    await rpc("admit", {
      event_id: "event-1",
      nonce: "nonce-1",
      run_id: "run-1",
      intent: "continue",
      request_digest: "a".repeat(64),
      now: time,
    });
    const a = await rpc("reserve", {
      attempt_id: "attempt-1",
      run_id: "run-1",
      claim_id: "claim-1",
      worker_id: "worker-1",
      generation: 1,
      issue_number: 1,
      role: "implementation",
      context_id: "context-1",
      head_sha: "1".repeat(40),
      now: time,
    });
    return {
      child,
      rpc,
      a,
      async kill() {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const done = once(child, "exit");
        child.kill("SIGKILL");
        await done;
      },
    };
  }
  for (const when of ["before COMMIT", "after COMMIT"])
    test(
      "SIGKILL " + when + " keeps model budget and request rows consistent",
      { timeout: 15000 },
      async () => {
        const directory = mkdtempSync(join(tmpdir(), "runner-crash-"));
        chmodSync(directory, 0o700);
        const p = profile();
        p.limits.cost_microusd = 50000;
        let raw, reader, l;
        try {
          raw = await backend(directory, p);
          const q = {
            request_id: "request-1",
            attempt_id: raw.a.attempt_id,
            epoch: raw.a.epoch,
            input_digest: "c".repeat(64),
            now: time,
          };
          let outstanding;
          if (when === "before COMMIT") {
            reader = spawn(
              "python3",
              [
                "-c",
                "import sqlite3,sys\nc=sqlite3.connect(sys.argv[1],isolation_level=None)\nc.execute('BEGIN')\nc.execute('SELECT * FROM meta').fetchall()\nprint('locked',flush=True)\nsys.stdin.readline()\nc.rollback()\nc.close()",
                join(directory, "runner.sqlite"),
              ],
              { stdio: ["pipe", "pipe", "pipe"] },
            );
            reader.stderr.resume();
            await once(reader.stdout, "data");
            outstanding = raw.rpc("reserve_usage", q).catch(() => null);
            for (
              let i = 0;
              i < 100 && !existsSync(join(directory, "runner.sqlite-journal"));
              i++
            )
              await new Promise((r) => setTimeout(r, 5));
            assert.ok(existsSync(join(directory, "runner.sqlite-journal")));
          } else await raw.rpc("reserve_usage", q);
          await raw.kill();
          await outstanding;
          if (reader) {
            const done = once(reader, "exit");
            reader.stdin.end("\n");
            await done;
          }
          l = await openLedger({ directory, profile: p });
          const v = await l.view();
          assert.equal(v.recovery_required, true);
          assert.equal(v.attempts.length, 1);
          if (when === "before COMMIT") {
            assert.deepEqual(v.usage, []);
            assert.equal(v.runs[0].spent, 0);
            assert.equal(v.runs[0].requests, 0);
          } else {
            assert.equal(v.usage[0].status, "unknown");
            assert.ok(v.runs[0].spent > 0);
            assert.equal(v.runs[0].requests, 1);
            await assert.rejects(
              l.settleUsage({
                ...q,
                input_tokens: 1,
                output_tokens: 1,
                response_digest: "d".repeat(64),
              }),
            );
          }
        } finally {
          await l?.close();
          await raw?.kill();
          reader?.kill("SIGKILL");
          rmSync(directory, { recursive: true, force: true });
        }
      },
    );
}

for (const path of [".codex", ".agents", "src/.ssh", ".aws"])
  test("control and credential roots cannot become writable: " + path, () => {
    const p = profile({
      read_paths: [path],
      write_paths: [path],
      send_paths: [path],
    });
    assert.equal(checkProfile(p, time).status, "blocked");
  });
test("a readable file outside the approved model send paths never enters the worker snapshot", () => {
  const root = mkdtempSync(join(tmpdir(), "runner-send-"));
  try {
    const p = profile({ send_paths: ["src"] });
    assert.throws(() =>
      prepareWorkspace({
        directory: root,
        profile: p,
        files: [{ path: "tests/private.js", content: "must stay local" }],
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("committed Runner examples match only the independent runner/v1 contracts and cannot authorize execution", async () => {
  const { readFileSync } = await import("node:fs"),
    { parseYaml } = await import("../../tools/workflow-rules/load.mjs"),
    { valid } = await import("../../tools/workflow-runner/core.mjs");
  for (const kind of ["profile", "request", "capability", "result"]) {
    const value = parseYaml(
      readFileSync(
        new URL(
          "../../.ai-workflow/templates/runner/v1/" + kind + ".yaml",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.equal(valid(kind, value), true, kind);
    if (kind === "profile") assert.equal(value.limits.cost_microusd, 0);
    if (kind === "capability")
      assert.ok(Object.values(value.checks).every((x) => x === false));
    if (kind === "result") assert.equal(value.status, "blocked");
  }
});

test("a real provider transport cannot accidentally be installed in synthetic mode", async () => {
  const { createProviderTransport } = await import(
    "../../tools/workflow-runner/gateway.mjs"
  );
  const upstream = createProviderTransport({
    credential: "synthetic-provider-placeholder",
  });
  assert.throws(() =>
    createGateway({
      mode: "synthetic",
      profile: profile(),
      clock: () => time,
      ledger: { reserveUsage: async () => {}, settleUsage: async () => {} },
      observeAttempt: async () => {},
      upstream,
    }),
  );
});

test("a run cannot consume an eleventh distinct Issue even after earlier workers stop", async () => {
  const directory = mkdtempSync(join(tmpdir(), "runner-issue-cap-")),
    p = profile();
  let l;
  try {
    l = await openLedger({ directory, profile: p });
    await l.admit({
      event_id: "event-1",
      nonce: "nonce-1",
      run_id: "run-1",
      intent: "continue",
      request_digest: "a".repeat(64),
      now: time,
    });
    const q = (n) => ({
      attempt_id: "attempt-" + n,
      run_id: "run-1",
      claim_id: "claim-" + n,
      worker_id: "worker-" + n,
      generation: 1,
      issue_number: n,
      role: "implementation",
      context_id: "context-" + n,
      head_sha: "1".repeat(40),
      now: time,
    });
    for (let n = 1; n <= 10; n++) {
      const a = await l.reserve(q(n));
      await l.observe({
        attempt_id: a.attempt_id,
        epoch: a.epoch,
        status: "stopped",
        container_id: null,
        stopped: true,
        artifact_digest: null,
        now: time,
      });
    }
    await assert.rejects(l.reserve(q(11)));
  } finally {
    await l?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("artifact collection refuses invalid UTF-8 rather than publishing replacement bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "runner-utf8-"));
  try {
    const w = prepareWorkspace({ directory, profile: profile(), files: [] });
    writeFileSync(join(w.mounts[0].source, "bad.txt"), Buffer.from([255]));
    assert.throws(() => collectArtifacts(w));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

{
  function cancellationGateway(upstream) {
    const p = profile();
    p.limits.call_seconds = 1;
    let reserved = 0,
      settled = 0;
    const gateway = createGateway({
      mode: "synthetic",
      profile: p,
      clock: () => time,
      upstream,
      ledger: {
        reserveUsage: async () => {
          reserved++;
        },
        settleUsage: async () => {
          settled++;
        },
      },
      observeAttempt: async () => ({
        attempt_id: "attempt-1",
        run_id: "run-1",
        epoch: 1,
        active: true,
        stopped: false,
      }),
    });
    return {
      gateway,
      body: { model: p.model.id, input: "Synthetic cancellation test" },
      counts: () => ({ reserved, settled }),
    };
  }
  test("a model deadline reaches the provider cancellation signal and keeps its reservation", async () => {
    let observedSignal;
    const s = cancellationGateway(
      async (body, options) =>
        new Promise((resolve, reject) => {
          observedSignal = options?.signal;
          observedSignal?.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
        }),
    );
    await assert.rejects(
      s.gateway.request(
        { method: "POST", path: "/v1/responses", body: s.body },
        "attempt-1",
      ),
    );
    assert.equal(observedSignal?.aborted, true);
    assert.equal(s.gateway.unknown, true);
    assert.deepEqual(s.counts(), { reserved: 1, settled: 0 });
  });
  test("closing a worker model socket cancels the active host call without releasing unknown usage", async () => {
    const { serveGateway } = await import(
        "../../tools/workflow-runner/gateway.mjs"
      ),
      { request } = await import("node:http");
    const directory = mkdtempSync(join(tmpdir(), "runner-cancel-"));
    let server, client, started, cancelled;
    const ready = new Promise((r) => (started = r)),
      aborted = new Promise((r) => (cancelled = r));
    const s = cancellationGateway(
      async (body, options) =>
        new Promise((resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              cancelled();
              reject(new Error("cancelled"));
            },
            { once: true },
          );
          started();
        }),
    );
    try {
      const socket = join(directory, "model.sock");
      server = await serveGateway({
        socket,
        attempt_id: "attempt-1",
        gateway: s.gateway,
      });
      client = request(
        {
          socketPath: socket,
          method: "POST",
          path: "/v1/responses",
          headers: { "content-type": "application/json" },
        },
        () => {},
      );
      client.on("error", () => {});
      client.end(JSON.stringify(s.body));
      await ready;
      await server.close();
      let timer;
      try {
        await Promise.race([
          aborted,
          new Promise((resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("host call was not cancelled")),
              2000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      await new Promise(setImmediate);
      assert.equal(s.gateway.unknown, true);
      assert.deepEqual(s.counts(), { reserved: 1, settled: 0 });
    } finally {
      client?.destroy();
      await server?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("the fixed provider helper terminates when its host parent dies without sending a request", async () => {
  const { spawn } = await import("node:child_process"),
    { once } = await import("node:events"),
    { readFileSync } = await import("node:fs");
  const helper = new URL(
    "../../tools/workflow-runner/provider_http.py",
    import.meta.url,
  ).pathname;
  const childCode =
    "import runpy,time\nm=runpy.run_path(" +
    JSON.stringify(helper) +
    ",run_name='lifecycle_probe')\nm['bind_parent']()\nprint('READY',flush=True)\ntime.sleep(30)";
  const launcherCode =
    "import subprocess,sys,json\np=subprocess.Popen([sys.executable,'-c'," +
    JSON.stringify(childCode) +
    "],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)\nprint(json.dumps({'pid':p.pid,'ready':p.stdout.readline().decode().strip()}),flush=True)\nsys.stdin.readline()\np.wait()";
  const launcher = spawn("python3", ["-c", launcherCode], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  launcher.stderr.resume();
  let pid;
  function running() {
    try {
      return !/\) Z /.test(readFileSync("/proc/" + pid + "/stat", "utf8"));
    } catch {
      return false;
    }
  }
  try {
    const [data] = await once(launcher.stdout, "data"),
      ready = JSON.parse(data.toString());
    pid = ready.pid;
    assert.equal(ready.ready, "READY");
    const exited = once(launcher, "exit");
    launcher.kill("SIGKILL");
    await exited;
    for (let n = 0; n < 100 && running(); n++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(running(), false);
  } finally {
    if (pid && running())
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    if (launcher.exitCode === null && launcher.signalCode === null) {
      const exited = once(launcher, "exit");
      launcher.kill("SIGKILL");
      await exited;
    }
    launcher.stdin.end();
  }
});

// P7 tests share this file to keep every static target inside the existing argv cap.
// The original Runner suite has no new dependency or activation side effect.
if (process.env.WORKFLOW_CONTINUATION_TEST === "1") {
  const [continuation, dispatch, fsExtra] = continuationImports;
  const {
    planContinuation,
    createSyntheticContinuationAdapter,
    openContinuation,
    validateContinuationArtifact,
    renderContinuationReport,
  } = continuation;
  const {
    fixture: dispatchInput,
    claim: dispatchClaim,
    time: ct,
    bind,
  } = dispatch;
  const { readdirSync, readFileSync, appendFileSync } = fsExtra;
  const cp = () => ({
    schema_version: 1,
    artifact_kind: "continuation-profile",
    id: "synthetic-continuation",
    revision: 1,
    mode: "synthetic",
    repository: "example/project",
    repository_id: 1,
    human_owner: "example-user",
    owner_id: 7,
    policy_digest: "a".repeat(64),
    configuration_digest: dispatchInput().ledger.configuration_digest,
    execution_profile_digest: hash(dispatchInput().profile),
    integration_profile_digest: "9".repeat(64),
    reviewed_at: "2026-11-04T00:00:00Z",
    expires_at: "2026-11-04T06:00:00Z",
    required_stages: ["implementation", "verification", "review", "security"],
    limits: {
      max_issues: 10,
      max_concurrent_issues: 2,
      max_workers: 3,
      run_seconds: 21600,
      cleanup_seconds: 600,
      call_seconds: 1800,
      max_repairs: 3,
      monitor_seconds: 30,
      idle_observations: 2,
      observations: 400,
      operations: 100,
      reports: 100,
      journal_bytes: 33554432,
      events: 10000,
      artifact_bytes: 104857600,
      summary_bytes: 32768,
      model_calls: 0,
      provider_budget: 0,
      simulated_calls: 100,
      simulated_cost_units: 10000,
      batch_calls: 20,
      batch_cost_units: 1000,
    },
  });
  function profileFor(f) {
    const p = cp();
    p.repository = f.project.repository;
    p.human_owner = f.profile.human_owner;
    p.configuration_digest = f.ledger.configuration_digest;
    p.execution_profile_digest = hash(f.profile);
    return p;
  }
  async function continuationFixture(t, options = {}) {
    const f = options.input ?? dispatchInput(),
      p = profileFor(f),
      directory = mkdtempSync(join(tmpdir(), "continuation-68-"));
    options.change?.(f, p);
    const requests = new Set(),
      jobs = new Map(),
      knownHandles = new Set(),
      reports = [];
    let sequence = 0,
      clockTime = ct,
      starts = 0,
      stops = 0,
      c;
    const clock = () => clockTime;
    const q = (intent = "continue", patch = {}) => {
      const r = {
        schema_version: 1,
        artifact_kind: "continuation-request",
        repository: p.repository,
        repository_id: p.repository_id,
        owner_id: p.owner_id,
        run_id: "parent-run",
        profile_digest: hash(p),
        policy_digest: p.policy_digest,
        event_id: "event-" + ++sequence,
        nonce: "nonce-" + sequence,
        intent,
        issued_at: clockTime,
        expires_at: new Date(Date.parse(clockTime) + 60000).toISOString(),
        source: {
          id: "source-" + sequence,
          actor_id: p.owner_id,
          actor_type: "User",
          body_digest: hash({ intent, sequence }),
          updated_at: clockTime,
        },
        requested_issues: null,
        ...patch,
      };
      requests.add(hash(r));
      return r;
    };
    const outcome = (n) => {
      const target = f.grant.selected.find((t) => t.issue_number === n),
        head = target.head_sha;
      const item = {
        issue_number: n,
        claim_id: "claim-" + n,
        head_sha: head,
        plan_digest: target.plan.digest,
        pr_number: 10 + n,
        status: options.held === n ? "held" : "passed",
        repairs: 0,
        proofs: p.required_stages.map((stage) => ({
          stage,
          status: "passed",
          head_sha: head,
          plan_digest: target.plan.digest,
          profile_digest: p.execution_profile_digest,
          context_id:
            stage === "implementation"
              ? "impl-" + n
              : stage === "review"
                ? "review-" + n
                : null,
          evidence_refs: [source("p7-" + stage + "-" + n)],
        })),
      };
      if (options.missingStage)
        item.proofs = item.proofs.filter(
          (x) => x.stage !== options.missingStage,
        );
      if (options.sameContext)
        item.proofs.find((x) => x.stage === "review").context_id = "impl-" + n;
      if (options.staleProof) item.proofs[0].head_sha = "f".repeat(40);
      return item;
    };
    const ports = {
      async authorizeRequest({ request, binding_digest }) {
        return {
          mode: "synthetic",
          allowed:
            requests.has(hash(request)) && request.source.actor_type === "User",
          binding_digest,
          observed_at: clockTime,
        };
      },
      async observe() {
        const value = structuredClone(f);
        value.evaluated_at = clockTime;
        return {
          dispatcher_input: value,
          observed_at: clockTime,
          main_sha: f.snapshot.branches[0].sha,
          worker_count: [...jobs.values()]
            .filter((j) => !j.done)
            .reduce((n, j) => n + j.numbers.length, 0),
        };
      },
      async reserve({ issue_numbers, operation_id }) {
        const reservations = issue_numbers.map((n) => {
          const target = f.grant.selected.find((t) => t.issue_number === n),
            handle = Object.freeze({}),
            task = dispatchClaim({
              claim_id: "claim-" + n,
              worker_id: "worker-" + n,
              run_id: f.grant.run_id,
              issue_number: n,
              feature_id: n === 1 ? "a" : "b",
              areas: n === 1 ? ["backend"] : ["frontend"],
              allowed_paths: target.allowed_paths,
              head_sha: target.head_sha,
              profile_digest: hash(f.profile),
              grant_digest: hash(f.grant),
              contract_digest: target.contract_digest,
              design_digest: target.design_digest,
              stages: target.stages,
              status: "ready",
              execution_active: true,
            });
          knownHandles.add(handle);
          f.ledger.claims.push(task);
          return { claim: structuredClone(task), handle };
        });
        return {
          status: options.reserveUnknown ? "unknown" : "passed",
          reservations,
        };
      },
      async revalidate({ reservation }) {
        return {
          status: knownHandles.has(reservation.handle) ? "passed" : "blocked",
        };
      },
      async start({ batch_id, reservations }) {
        starts++;
        const handle = Object.freeze({});
        jobs.set(handle, {
          batch_id,
          numbers: reservations.map((r) => r.claim.issue_number),
          done: false,
        });
        await options.startWait?.();
        return handle;
      },
      async poll({ handle }) {
        const j = jobs.get(handle);
        if (!j) throw Error("unknown");
        await options.pollWait?.();
        if (options.pending)
          return { status: "running", worker_count: j.numbers.length };
        j.done = true;
        for (const n of j.numbers) {
          const target = f.grant.selected.find((t) => t.issue_number === n);
          if (!f.snapshot.prs.some((pr) => pr.number === 10 + n))
            f.snapshot.prs.push({
              id: 100 + n,
              number: 10 + n,
              state: "open",
              draft: true,
              head_branch: "feature/" + n,
              head_sha: target.head_sha,
              base_branch: f.snapshot.default_branch,
              base_sha: f.snapshot.branches[0].sha,
              head_repository_id: p.repository_id,
              merged: false,
              updated_at: clockTime,
              body_digest: hash({ issue: n }),
              actor_id: p.owner_id,
            });
          const row = f.ledger.claims.find((c) => c.issue_number === n);
          row.status = options.held === n ? "blocked" : "in_review";
          row.execution_active = false;
        }
        return {
          status: "complete",
          worker_stopped: true,
          usage: {
            status: options.unknownUsage ? "unknown" : "known",
            calls: j.numbers.length * 2,
            cost_units: j.numbers.length,
          },
          items: j.numbers.map(outcome),
        };
      },
      async integrate({ targets, main_sha }) {
        return {
          status: options.integrationFail ? "failed" : "passed",
          main_sha: options.staleIntegration ? "e".repeat(40) : main_sha,
          targets: targets.map((x) => ({
            issue_number: x.issue_number,
            head_sha: x.head_sha,
            plan_digest: x.plan_digest,
          })),
          profile_digest: p.integration_profile_digest,
          recommended_merge_order: targets.map((t) => t.issue_number),
          evidence_refs: [source("p7-integration")],
        };
      },
      async notify(value) {
        reports.push(structuredClone(value));
        if (options.reportUnknown) throw Error("SYNTHETIC_PRIVATE_CONTENT");
        return { confirmed: true, report_digest: value.report_digest };
      },
      async stop() {
        stops++;
        for (const j of jobs.values()) j.done = true;
        for (const row of f.ledger.claims) {
          row.execution_active = false;
          if (row.status === "ready") row.status = "blocked";
        }
        return { stopped: true };
      },
      async reconcile({ state_digest }) {
        return {
          state_digest,
          observed_at: clockTime,
          workers_stopped: options.reconcileUnknown !== true,
          operations_reconciled: options.reconcileUnknown !== true,
          settlements: [...jobs.values()].map((j) => ({
            batch_id: j.batch_id,
            usage: {
              status: "known",
              calls: j.numbers.length * 2,
              cost_units: j.numbers.length,
            },
          })),
        };
      },
    };
    options.extendPorts?.(ports, { f, p });
    const adapter = createSyntheticContinuationAdapter(ports);
    c = await openContinuation({ directory, profile: p, adapter, clock });
    t.after(async () => {
      await c.close();
      rmSync(directory, { recursive: true, force: true });
    });
    return {
      c,
      p,
      f,
      q,
      adapter,
      ports,
      reports,
      directory,
      jobs,
      clock,
      setTime(v) {
        clockTime = v;
      },
      get starts() {
        return starts;
      },
      get stops() {
        return stops;
      },
    };
  }
  test("P7 AC1: choose independent Issues without a user list; record all stages and integration", async (t) => {
    const r = await continuationFixture(t);
    await r.c.accept(r.q(), { drive: false });
    await r.c.tick();
    assert.equal(r.starts, 1);
    const done = await r.c.tick();
    assert.deepEqual(
      done.issues.map((x) => x.issue_number),
      [1, 2],
    );
    assert(done.issues.every((x) => x.status === "review_ready"));
    assert.equal(done.actual_model_calls, 0);
    assert.equal(done.provider_cost, 0);
    assert.equal(done.usage.simulated_calls, 4);
    assert.equal(validateContinuationArtifact("report", done).valid, true);
    await r.c.tick();
    assert.equal((await r.c.tick()).status, "waiting");
    assert.equal(r.starts, 1);
    assert(r.reports.some((x) => x.kind === "review_ready"));
    assert(renderContinuationReport(done).includes("synthetic"));
  });
  test("P7 AC2: one held Issue does not discard an independent successful Issue", async (t) => {
    const r = await continuationFixture(t, { held: 1 });
    await r.c.accept(r.q(), { drive: false });
    await r.c.tick();
    const done = await r.c.tick();
    assert.equal(done.issues.find((i) => i.issue_number === 1).status, "held");
    assert.equal(
      done.issues.find((i) => i.issue_number === 2).status,
      "review_ready",
    );
  });
  test("P7 AC1/2: explicit scope, known blocker, dependencies and full-inventory failure preserve P4 rules", async () => {
    const f = dispatchInput(),
      p = profileFor(f);
    let d = planContinuation({
      profile: p,
      inventory: {
        dispatcher_input: f,
        observed_at: ct,
        main_sha: f.snapshot.branches[0].sha,
        worker_count: 0,
      },
      state: null,
      requested_issues: null,
      now: ct,
    });
    assert.deepEqual(
      d.selected.map((x) => x.issue_number),
      [1, 2],
    );
    assert.equal(d.authority, false);
    f.issue_facts[0].blocker = "known";
    d = planContinuation({
      profile: p,
      inventory: {
        dispatcher_input: f,
        observed_at: ct,
        main_sha: f.snapshot.branches[0].sha,
        worker_count: 0,
      },
      state: null,
      requested_issues: null,
      now: ct,
    });
    assert.deepEqual(
      d.selected.map((x) => x.issue_number),
      [2],
    );
    f.snapshot.status = "partial";
    d = planContinuation({
      profile: p,
      inventory: {
        dispatcher_input: f,
        observed_at: ct,
        main_sha: f.snapshot.branches[0].sha,
        worker_count: 0,
      },
      state: null,
      requested_issues: null,
      now: ct,
    });
    assert.equal(d.status, "blocked");
    assert.equal(d.selected.length, 0);
  });
  test("P7 AC3: missing review, reused context, stale proof and failed integration cannot become review-ready", async (t) => {
    for (const option of [
      { missingStage: "review" },
      { sameContext: true },
      { staleProof: true },
      { integrationFail: true },
      { staleIntegration: true },
    ]) {
      const r = await continuationFixture(t, option);
      await r.c.accept(r.q(), { drive: false });
      await r.c.tick();
      const done = await r.c.tick();
      assert(
        done.issues.every((x) => x.status !== "review_ready"),
        JSON.stringify(option),
      );
    }
  });
  test("P7 AC4: request replay is idempotent; status does not stop or start work; forged sources are denied", async (t) => {
    const r = await continuationFixture(t, { pending: true }),
      request = r.q();
    await r.c.accept(request, { drive: false });
    await r.c.tick();
    const before = await r.c.status();
    const status = await r.c.accept(r.q("status"));
    assert.equal(status.status, "running");
    assert.equal(r.stops, 0);
    assert.equal(r.starts, 1);
    await r.c.accept(request, { drive: false });
    assert.deepEqual((await r.c.status()).usage, before.usage);
    assert.equal(r.starts, 1);
    const forged = structuredClone(request);
    forged.source.actor_type = "Bot";
    assert.equal((await r.c.accept(forged)).request_status, "rejected");
    assert.equal(r.stops, 0);
    assert.equal(r.starts, 1);
  });
  test("P7 AC4: stop fences pending starts and requires reconciliation; new continue cannot reset counters", async (t) => {
    let release, entered;
    const started = new Promise((r) => {
      entered = r;
    });
    const waiting = new Promise((r) => {
      release = r;
    });
    const r = await continuationFixture(t, {
      pending: true,
      startWait: async () => {
        entered();
        await waiting;
      },
    });
    await r.c.accept(r.q(), { drive: false });
    const tick = r.c.tick();
    await started;
    const stopping = r.c.accept(r.q("stop"));
    release();
    await stopping;
    await tick;
    const stopped = await r.c.status();
    assert(["stopped", "reconcile_required"].includes(stopped.status));
    const count = r.starts;
    await r.c.accept(r.q(), { drive: false });
    assert.equal(r.starts, count);
    assert.equal(
      (await r.c.status()).usage.reserved_calls,
      stopped.usage.reserved_calls,
    );
    await r.c.reconcile();
    await r.c.accept(r.q(), { drive: false });
    assert.equal((await r.c.status()).run_id, "parent-run");
    assert.equal(r.starts, count);
  });
  test("P7 AC4: a narrowed instruction cannot silently widen again or leave excluded workers running", async (t) => {
    const r = await continuationFixture(t, { pending: true });
    await r.c.accept(r.q(), { drive: false });
    await r.c.tick();
    await r.c.accept(r.q("constrain", { requested_issues: [1] }), {
      drive: false,
    });
    assert(r.stops > 0);
    const next = await r.c.accept(
      r.q("continue", { requested_issues: [1, 2] }),
      { drive: false },
    );
    assert.equal(next.request_status, "rejected");
    assert.equal(r.starts, 1);
  });
  test("P7 AC4/5: unknown usage and publication outcomes retain reservations, do not blindly retry", async (t) => {
    const a = await continuationFixture(t, { unknownUsage: true });
    await a.c.accept(a.q(), { drive: false });
    await a.c.tick();
    const bad = await a.c.tick();
    assert.equal(bad.status, "reconcile_required");
    assert(bad.usage.reserved_calls > 0);
    const b = await continuationFixture(t, { reportUnknown: true });
    const result = await b.c.accept(b.q(), { drive: false });
    assert.equal(result.status, "reconcile_required");
    const notices = b.reports.length;
    await b.c.accept(b.q(), { drive: false });
    assert.equal(b.reports.length, notices);
    assert.equal(b.starts, 0);
    assert(!JSON.stringify(result).includes("SYNTHETIC_PRIVATE_CONTENT"));
  });
  test("P7 NFR: total Issue/usage limits survive continuation and profile changes do not grant budget", async (t) => {
    const r = await continuationFixture(t, {
      change(f, p) {
        p.limits.max_issues = 1;
      },
    });
    await r.c.accept(r.q(), { drive: false });
    await r.c.tick();
    await r.c.tick();
    for (let n = 0; n < 3; n++) await r.c.tick();
    assert.equal(r.starts, 1);
    const before = await r.c.status();
    await r.c.accept(r.q(), { drive: false });
    assert.equal(
      (await r.c.status()).usage.simulated_calls,
      before.usage.simulated_calls,
    );
    const invalid = r.q();
    invalid.profile_digest = "f".repeat(64);
    assert.equal((await r.c.accept(invalid)).request_status, "rejected");
  });
  test("P7 Security: JSON adapters, accessors, production profiles and unknown fields grant no authority", async (t) => {
    const r = await continuationFixture(t),
      p = structuredClone(r.p);
    p.mode = "production";
    assert.equal(validateContinuationArtifact("profile", p).valid, false);
    const d = mkdtempSync(join(tmpdir(), "continuation-denied-"));
    t.after(() => rmSync(d, { recursive: true, force: true }));
    await assert.rejects(
      openContinuation({
        directory: d,
        profile: r.p,
        adapter: { approved: true },
        clock: r.clock,
      }),
    );
    let called = false;
    const evil = {
      get profile() {
        called = true;
        throw Error();
      },
    };
    assert.equal(planContinuation(evil).status, "blocked");
    assert.equal(called, false);
    const invalid = r.q();
    invalid.approved = true;
    assert.equal((await r.c.accept(invalid)).request_status, "rejected");
  });
  test("P7 Resiliency: exclusive writer, tampered checkpoint, restart and bounded recovery", async (t) => {
    const r = await continuationFixture(t);
    await r.c.accept(r.q(), { drive: false });
    await r.c.tick();
    await assert.rejects(
      openContinuation({
        directory: r.directory,
        profile: r.p,
        adapter: r.adapter,
        clock: r.clock,
      }),
    );
    await r.c.close();
    const restored = await openContinuation({
      directory: r.directory,
      profile: r.p,
      adapter: r.adapter,
      clock: r.clock,
    });
    t.after(() => restored.close());
    assert.equal((await restored.status()).status, "reconcile_required");
    await restored.close();
    appendFileSync(join(r.directory, "continuation.jsonl"), "broken\n");
    await assert.rejects(
      openContinuation({
        directory: r.directory,
        profile: r.p,
        adapter: r.adapter,
        clock: r.clock,
      }),
    );
  });
  test("P7 AC5: main changes invalidate integration; expiry fences work; reports expose no raw content", async (t) => {
    const r = await continuationFixture(t);
    await r.c.accept(r.q(), { drive: false });
    await r.c.tick();
    await r.c.tick();
    r.f.snapshot.branches[0].sha = "e".repeat(40);
    await r.c.tick();
    const current = await r.c.status();
    assert(!JSON.stringify(current).includes("stdout_base64"));
    await r.c.accept(r.q(), { drive: false });
    r.setTime("2026-11-04T06:00:01Z");
    await r.c.tick();
    assert.notEqual((await r.c.status()).status, "running");
    assert(r.stops > 0);
  });
  test("P7 AC6: synthetic bridge uses actual P3/P4 claims, P5 stages/evidence and P6 integration without model calls", async (t) => {
    const { controllerFixture } = await import(
      "../workflow-dispatch/controller-fixture.mjs"
    );
    const { verifyRunAuthorization } = await import(
      "../../tools/workflow-github/auth.mjs"
    );
    const {
      createIntegrationAuthority,
      createSyntheticIntegrationExecutor,
      openIntegrationController,
    } = await import("../../tools/workflow-integration/controller.mjs");
    const { ref } = await import("../workflow-execution/fixture.mjs");
    const { parse } = await import(
      "../../tools/workflow-continuation/node_modules/yaml/dist/index.js"
    );
    const d = await controllerFixture();
    t.after(() => d.close());
    const ep = d.f.profile,
      rp = profile({
        execution_profile_digest: hash(ep),
        policy_digest: hash(d.g.policy),
      });
    const ip = parse(
      readFileSync(
        new URL(
          "../../.ai-workflow/templates/integration/v1/profile.yaml",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    ip.repository = d.f.project.repository;
    ip.execution_profile = ref(ep);
    ip.reviewed_at = "2026-11-04T00:00:00Z";
    ip.expires_at = "2026-11-04T06:00:00Z";
    let reserved,
      runnerResult,
      evaluatedInput,
      supervisor,
      runnerDirectory,
      stageCount = 0,
      integrationCount = 0;
    const prepared = new Map(),
      stageHistory = [];
    function evidence(claim, attempts) {
      const input = execution();
      input.profile = structuredClone(ep);
      input.grant = structuredClone(d.f.grant);
      input.context.subject = structuredClone(input.grant.selected[0]);
      const {
        contract_digest,
        design_digest,
        stages,
        allowed_paths,
        forbidden_paths,
        shared_areas,
        approval_refs,
        ...subject
      } = input.context.subject;
      input.context.subject = subject;
      input.context.evaluated_at = ct;
      input.context.contract_digest = contract_digest;
      input.context.design_digest = design_digest;
      input.verifications[0].subject = structuredClone(subject);
      input.verifications[0].test_count = 1;
      input.verifications[0].started_at = ct;
      input.verifications[0].finished_at = ct;
      const a = attempts.findLast((a) => a.role === "verification");
      if (a)
        input.verifications[0].log_refs = [
          { ...source("actual-verification"), digest: a.artifact_digest },
        ];
      input.reviews[0].subject = structuredClone(subject);
      input.reviews[0].started_at = ct;
      input.reviews[0].finished_at = ct;
      input.reviews[0].implementer.context_id =
        attempts.findLast((a) => a.role === "implementation")?.context_id ??
        "missing";
      input.reviews[0].reviewer.context_id =
        attempts.findLast((a) => a.role === "review")?.context_id ?? "missing";
      const review = attempts.findLast((a) => a.role === "review");
      if (review)
        input.reviews[0].evidence_refs.push({
          ...source("actual-review"),
          digest: review.artifact_digest,
        });
      rebind(input);
      return input;
    }
    const r = await continuationFixture(t, {
      input: d.f,
      change(f, p) {
        p.policy_digest = hash(d.g.policy);
        p.integration_profile_digest = hash(ip);
      },
      extendPorts(ports, { f, p }) {
        ports.observe = async () => {
          f.ledger = await d.dispatcher.inspect();
          return {
            dispatcher_input: structuredClone(f),
            observed_at: ct,
            main_sha: f.snapshot.branches[0].sha,
            worker_count: 0,
          };
        };
        ports.reserve = async ({ issue_numbers }) => {
          const result = await d.dispatcher.reserve({
            ...f,
            requested_issues: issue_numbers,
          });
          assert.equal(result.status, "passed", JSON.stringify(result));
          reserved = result.reservations[0];
          for (const kind of ["create_branch", "append_claim"])
            assert.equal(
              (
                await d.dispatcher.execute(
                  reserved.handle,
                  d.operation(reserved.claim, kind),
                )
              ).status,
              "confirmed",
            );
          assert.equal(
            (await d.dispatcher.handoff(reserved.handle)).status,
            "ready",
          );
          f.ledger = await d.dispatcher.inspect();
          return result;
        };
        ports.revalidate = ({ reservation }) =>
          d.dispatcher.revalidate(reservation.handle);
        ports.start = async () => {
          runnerDirectory = mkdtempSync(join(tmpdir(), "continuation-p5-"));
          const signed = signedRequest(rp);
          signed.envelope.payload.issued_at = ct;
          signed.envelope.payload.source_updated_at = ct;
          signed.envelope.payload.expires_at = "2026-11-04T00:11:00Z";
          signed.source.updated_at = ct;
          signed.source.observed_at = ct;
          signed.envelope.signature = sign(
            null,
            Buffer.from(
              "workflow-runner:v1:request\n" +
                canonical({
                  issuer: signed.envelope.issuer,
                  key_id: signed.envelope.key_id,
                  payload: signed.envelope.payload,
                }),
            ),
            signed.privateKey,
          ).toString("base64");
          const authority = createRunnerAuthority({
            mode: "synthetic",
            keys: [signed.key],
            readSource: async () => signed.source,
            clock: () => ct,
          });
          const adapter = createSyntheticAdapter({
            probe: async () => ({
              schema_version: 1,
              artifact_kind: "runner-capability",
              adapter_id: rp.adapter_id,
              adapter_digest: ADAPTER_DIGEST,
              image: rp.image,
              mode: "synthetic",
              observed_at: ct,
              checks: Object.fromEntries(
                [
                  "version",
                  "noninteractive",
                  "structured_output",
                  "isolated_write",
                  "network_none",
                  "credential_separation",
                  "resource_limits",
                  "stop_tree",
                  "resume",
                  "usage",
                  "model_gateway",
                ].map((k) => [k, true]),
              ),
              evidence_digest: "a".repeat(64),
            }),
            async start(q) {
              stageCount++;
              await q.onCreated("synthetic-" + stageCount);
              return q;
            },
            async observe(q) {
              const input = prepared.get(q.attempt.attempt_id);
              return {
                status: "completed",
                stopped: true,
                context_id: q.context_id,
                output:
                  q.role === "verification"
                    ? { exit_code: 0, test_count: 1, command: q.command }
                    : q.role === "review"
                      ? { message: JSON.stringify(input.reviews[0]) }
                      : {},
              };
            },
            async stop() {
              return { stopped: true };
            },
          });
          supervisor = await openSupervisor({
            directory: runnerDirectory,
            profile: rp,
            authority,
            adapter,
            dispatcher: d.dispatcher,
            mode: "synthetic",
            clock: () => ct,
            async prepareTask(q) {
              const input = evidence(q.claim, [...q.history, q.attempt]);
              prepared.set(q.attempt.attempt_id, input);
              const path = join(runnerDirectory, q.attempt.attempt_id);
              mkdirSync(path, { mode: 0o700 });
              return {
                workspace: prepareWorkspace({
                  directory: path,
                  profile: { ...rp, write_paths: ["src"] },
                  files: [{ path: "src/main.js", content: "Synthetic" }],
                }),
                prompt: "Synthetic task",
                execution_profile: ep,
                command_id: "unit",
              };
            },
            async evaluate(q) {
              evaluatedInput = evidence(q.claim, q.attempts);
              stageHistory.push(...q.attempts);
              return { input: evaluatedInput, repairable: false };
            },
          });
          runnerResult = await supervisor.accept(signed.envelope, [
            { claim_id: reserved.claim.claim_id, handle: reserved.handle },
          ]);
          assert.equal(
            runnerResult.status,
            "passed",
            JSON.stringify(runnerResult),
          );
          return Object.freeze({});
        };
        ports.poll = async () => {
          const item = {
            issue_number: 1,
            claim_id: reserved.claim.claim_id,
            head_sha: reserved.claim.head_sha,
            plan_digest: f.grant.selected[0].plan.digest,
            pr_number: 11,
            status: runnerResult.status,
            repairs: 0,
            proofs: p.required_stages.map((stage) => ({
              stage,
              status: "passed",
              head_sha: reserved.claim.head_sha,
              plan_digest: f.grant.selected[0].plan.digest,
              profile_digest: hash(ep),
              context_id:
                stageHistory.find(
                  (a) =>
                    a.role ===
                    (stage === "implementation"
                      ? "implementation"
                      : stage === "review"
                        ? "review"
                        : "verification"),
                )?.context_id ?? null,
              evidence_refs: [
                { ...source("actual-" + stage), digest: hash(evaluatedInput) },
              ],
            })),
          };
          f.snapshot.prs = [
            {
              id: 111,
              number: 11,
              state: "open",
              draft: true,
              head_branch: reserved.claim.branch,
              head_sha: reserved.claim.head_sha,
              base_branch: "main",
              base_sha: f.snapshot.branches[0].sha,
              head_repository_id: 1,
              merged: false,
              updated_at: ct,
              body_digest: hash(""),
              actor_id: 99,
            },
          ];
          d.g.state.snapshot = structuredClone(f.snapshot);
          d.g.state.execution = {
            ...d.g.state.execution,
            claim_id: reserved.claim.claim_id,
            worker_id: reserved.claim.worker_id,
            generation: reserved.claim.generation,
            branch: reserved.claim.branch,
            expected_head: reserved.claim.head_sha,
          };
          f.issue_facts[0].pr_numbers = [11];
          return {
            status: "complete",
            worker_stopped: true,
            usage: {
              status: "known",
              calls: stageCount,
              cost_units: stageCount,
            },
            items: [item],
          };
        };
        ports.integrate = async ({ targets, main_sha }) => {
          integrationCount++;
          const authorized = await verifyRunAuthorization(
            { ...d.g.input, snapshot: structuredClone(f.snapshot) },
            d.g.provider,
          );
          assert.equal(
            authorized.artifact.status,
            "allowed",
            JSON.stringify(authorized.artifact),
          );
          const authority = createIntegrationAuthority({
            mode: "synthetic",
            dispatcher: d.dispatcher,
            tasks: [{ issue_number: 1, handle: reserved.handle }],
            approveProfile: async (q) => ({
              binding_digest: q.binding_digest,
              approved: true,
              owner_id: 7,
              observed_at: ct,
              expires_at: "2026-11-04T06:00:00Z",
            }),
            authorize: async () => ({
              capability: authorized.capability,
              provider: d.g.provider,
              journal: d.g.journal,
            }),
          });
          const executor = createSyntheticIntegrationExecutor({
            prepare: async (q) => ({
              status: "passed",
              tree_sha: "a".repeat(40),
              commit_sha: "b".repeat(40),
              source_digest: hash(q.case),
              source: {},
            }),
            verify: async () => ({
              status: "passed",
              exit_code: 0,
              test_count: 1,
              stdout_base64: "",
              stderr_base64: "",
            }),
            stop: async () => ({ stopped: true }),
          });
          const path = mkdtempSync(join(tmpdir(), "continuation-p6-"));
          const controller = await openIntegrationController({
            directory: path,
            profile: ip,
            request: {
              schema_version: 1,
              artifact_kind: "integration-request",
              run_id: f.grant.run_id,
              repository: p.repository,
              repository_id: 1,
              profile_digest: hash(ip),
              main_sha,
              bundle_digest: "d".repeat(64),
              targets: targets.map((t) => ({
                ...t,
                pr_number: 11,
                depends_on: [],
              })),
            },
            authority,
            executor,
            clock: () => ct,
          });
          try {
            const result = await controller.run();
            assert.equal(
              result.status,
              "passed",
              JSON.stringify(result.diagnostics),
            );
            return {
              status: result.status,
              main_sha,
              targets,
              profile_digest: hash(ip),
              recommended_merge_order: targets.map((t) => t.issue_number),
              evidence_refs: [{ ...source("actual-p6"), digest: hash(result) }],
            };
          } finally {
            controller.close();
            rmSync(path, { recursive: true, force: true });
          }
        };
        ports.stop = async () => {
          if (supervisor) await supervisor.close();
          return { stopped: true };
        };
      },
    });
    t.after(async () => {
      if (supervisor) await supervisor.close();
      if (runnerDirectory)
        rmSync(runnerDirectory, { recursive: true, force: true });
    });
    await r.c.accept(r.q(), { drive: false });
    await r.c.tick();
    const done = await r.c.tick();
    assert.equal(runnerResult?.status, "passed", JSON.stringify(runnerResult));
    assert.equal(stageCount, 3, JSON.stringify(done));
    assert.equal(integrationCount, 1, JSON.stringify(done));
    assert.equal(done.issues[0].status, "review_ready", JSON.stringify(done));
    assert.equal(done.usage.simulated_calls, 3);
    assert.equal(done.actual_model_calls, 0);
    assert.equal(done.provider_cost, 0);
    assert.notEqual(
      evaluatedInput.reviews[0].implementer.context_id,
      evaluatedInput.reviews[0].reviewer.context_id,
    );
    assert.equal((await d.dispatcher.inspect()).claims[0].status, "ready"); // No implicit claim release or merge.
  });

  test("P7 AC1: a completed milestone selects the next independent batch under the same parent budget", async (t) => {
    const r = await continuationFixture(t, {
      change(f, p) {
        p.limits.max_concurrent_issues = 1;
      },
    });
    await r.c.accept(r.q(), { drive: false });
    await r.c.tick();
    assert.equal(r.starts, 1);
    const second = await r.c.tick();
    assert.equal(r.starts, 2);
    assert.deepEqual(
      second.issues.map((x) => x.issue_number),
      [1, 2],
    );
    assert.equal(second.issues[0].status, "review_ready");
    assert.equal(second.issues[1].status, "running");
    const done = await r.c.tick();
    assert.equal(done.usage.simulated_calls, 4);
    assert.equal(done.run_id, "parent-run");
  });
  test("P7 AC2: PR creation cannot satisfy dependency; observed merge and explicit P4 release enable the next Issue", async (t) => {
    const r = await continuationFixture(t, {
      change(f, p) {
        f.deliveryPlan.features[1].depends_on = [
          { feature_id: "a", reason: "synthetic" },
        ];
        bind(f);
        p.configuration_digest = f.ledger.configuration_digest;
      },
    });
    await r.c.accept(r.q(), { drive: false });
    await r.c.tick();
    await r.c.tick();
    assert.equal(r.starts, 1);
    r.f.issue_facts[0].pr_numbers = [11];
    await r.c.tick();
    assert.equal(r.starts, 1);
    r.f.snapshot.issues[0].state = "closed";
    r.f.snapshot.prs[0].state = "closed";
    r.f.snapshot.prs[0].merged = true;
    r.f.snapshot.branches[0].sha = "e".repeat(40);
    // The host reconciles stopped work and publication, then receives P4's release.
    r.f.ledger.claims[0].status = "released";
    r.f.ledger.claims[0].execution_active = false;
    await r.c.accept(r.q(), { drive: false });
    const next = await r.c.tick();
    assert.equal(r.starts, 2, JSON.stringify(next));
    assert.equal(next.issues[1].issue_number, 2);
  });
  test("P7 AC3: main update forces a new integration result and cannot reuse an earlier pass", async (t) => {
    let checks = 0;
    const f = await continuationFixture(t, {
      extendPorts(ports, { p }) {
        ports.integrate = async (q) => ({
          status: ++checks === 1 ? "passed" : "failed",
          main_sha: q.main_sha,
          targets: q.targets,
          profile_digest: p.integration_profile_digest,
          evidence_refs: [source("new-integration")],
        });
      },
    });
    await f.c.accept(f.q(), { drive: false });
    await f.c.tick();
    let result = await f.c.tick();
    assert(result.issues.every((i) => i.status === "review_ready"));
    f.f.snapshot.branches[0].sha = "e".repeat(40);
    result = await f.c.tick();
    assert.equal(checks, 2);
    assert(result.issues.every((i) => i.status === "held"));
  });
  test("P7 AC4: a malformed notification acknowledgment is unknown and fences all subsequent updates", async (t) => {
    const r = await continuationFixture(t, {
      extendPorts(ports) {
        ports.notify = async () => ({
          confirmed: true,
          report_digest: "f".repeat(64),
        });
      },
    });
    const result = await r.c.accept(r.q(), { drive: false });
    assert.equal(result.status, "reconcile_required");
    assert(r.stops > 0);
    const rows = readFileSync(join(r.directory, "continuation.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert(
      rows
        .at(-1)
        .checkpoint.state.outbox.some(
          (o) => o.kind === "notify" && o.status === "unknown",
        ),
    );
  });
  test("P7 NFR: all host authorization, observation and polling calls consume the same finite observation cap", async (t) => {
    let checks = 0;
    const r = await continuationFixture(t, {
      change(f, p) {
        p.limits.observations = 4;
      },
      extendPorts(ports) {
        const original = ports.revalidate;
        ports.revalidate = async (q) => {
          checks++;
          return original(q);
        };
      },
    });
    await r.c.accept(r.q(), { drive: false });
    await r.c.tick();
    await r.c.tick();
    const stopped = await r.c.status();
    assert.equal(stopped.observations, 4);
    assert.notEqual(stopped.status, "running");
    assert(r.stops > 0);
    assert(checks <= 2);
  });
  test("P7 Security: missing inventory, stale authority and wrong claim generation fence work without releasing claims", async (t) => {
    for (const change of [
      (f) => {
        f.snapshot.status = "partial";
      },
      (f) => {
        f.issue_facts[0].approval = "unknown";
      },
      (f) => {
        f.ledger.generation = 2;
      },
      (f) => {
        f.snapshot.permissions[0].permission = "read";
      },
    ]) {
      const r = await continuationFixture(t, { pending: true });
      await r.c.accept(r.q(), { drive: false });
      await r.c.tick();
      change(r.f);
      await r.c.tick();
      assert.notEqual((await r.c.status()).status, "running");
      assert.equal(r.starts, 1);
      assert(r.f.ledger.claims.every((c) => c.status !== "released"));
    }
  });
  test("P7 AC4: unknown reservation results cannot be retried or treated as confirmed", async (t) => {
    const r = await continuationFixture(t, { reserveUnknown: true });
    await r.c.accept(r.q(), { drive: false });
    const bad = await r.c.tick();
    assert.equal(bad.status, "reconcile_required");
    assert.equal(r.starts, 0);
    const rows = readFileSync(join(r.directory, "continuation.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert(
      rows
        .at(-1)
        .checkpoint.state.outbox.some(
          (o) => o.kind === "reserve" && o.status === "unknown",
        ),
    );
  });
  test("P7 NFR/Resiliency: journal and protected record limits fail closed, never yield a successful ready report", async (t) => {
    for (const limits of [
      { events: 4 },
      { artifact_bytes: 128 },
      { journal_bytes: 4096 },
      { reports: 1 },
      { operations: 1 },
      { simulated_calls: 20, batch_calls: 20 },
    ]) {
      const r = await continuationFixture(t, {
        change(f, p) {
          Object.assign(p.limits, limits);
          p.limits.max_concurrent_issues = 1;
        },
      });
      await r.c.accept(r.q(), { drive: false });
      for (let i = 0; i < 4; i++) await r.c.tick();
      const report = await r.c.status();
      assert.notEqual(report.status, "running");
      assert.equal(report.actual_model_calls, 0);
    }
  });

  test("P7 Resiliency: an unresolved late startup cannot be certified stopped or resumed", async (t) => {
    let entered, release;
    const enteredStart = new Promise((r) => (entered = r)),
      late = new Promise((r) => (release = r));
    const r = await continuationFixture(t, {
      change(f, p) {
        p.limits.cleanup_seconds = 1;
      },
      startWait: async () => {
        entered();
        await late;
      },
      pending: true,
    });
    await r.c.accept(r.q(), { drive: false });
    const work = r.c.tick();
    await enteredStart;
    const stopped = await r.c.accept(r.q("stop"));
    assert.equal(stopped.status, "reconcile_required");
    const before = r.starts;
    await r.c.accept(r.q(), { drive: false });
    assert.equal(r.starts, before);
    release();
    await work;
    assert.equal((await r.c.status()).status, "reconcile_required");
    assert((await r.c.status()).usage.reserved_calls > 0);
  });
  test("P7 NFR: hard caps, real-model budget and malformed source data cannot be increased by JSON", async (t) => {
    const r = await continuationFixture(t);
    for (const [key, value] of [
      ["max_issues", 11],
      ["max_concurrent_issues", 3],
      ["max_workers", 4],
      ["model_calls", 1],
      ["provider_budget", 1],
      ["monitor_seconds", 31],
    ]) {
      const p = structuredClone(r.p);
      p.limits[key] = value;
      assert.equal(
        validateContinuationArtifact("profile", p).valid,
        false,
        key,
      );
    }
    const oversized = r.q();
    oversized.source.id = "x".repeat(5 * 1024 * 1024 + 1);
    assert.equal((await r.c.accept(oversized)).request_status, "rejected");
    assert.equal(r.starts, 0);
    assert.equal(planContinuation(new Proxy({}, {})).status, "blocked");
  });
  test("P7 AC1/5: explicit Issue scope, repairs and pending reasons remain readable in safe reports", async (t) => {
    const r = await continuationFixture(t, {
      change(f) {
        f.issue_facts[0].blocker = "known";
      },
    });
    await r.c.accept(r.q("continue", { requested_issues: [1, 2] }), {
      drive: false,
    });
    await r.c.tick();
    let report = await r.c.tick();
    assert.equal(report.issues.length, 1);
    assert.equal(report.issues[0].issue_number, 2);
    assert(
      report.held.some(
        (h) => h.issue_number === 1 && h.reasons.includes("issue_blocked"),
      ),
    );
    assert(report.remaining_issues.includes(1));
    assert(!renderContinuationReport(report).includes("context_id"));
    assert.deepEqual(report.recommended_merge_order, [2]);
  });
  test("P7 AC6: every shipped continuation example validates independently but provides no runtime authority", async () => {
    const { parse } = await import(
      "../../tools/workflow-continuation/node_modules/yaml/dist/index.js"
    );
    const dir = new URL(
      "../../.ai-workflow/templates/continuation/v1/",
      import.meta.url,
    );
    for (const kind of [
      "profile",
      "request",
      "decision",
      "checkpoint",
      "report",
    ]) {
      const value = parse(readFileSync(new URL(kind + ".yaml", dir), "utf8"));
      assert.equal(validateContinuationArtifact(kind, value).valid, true, kind);
      if (["decision", "checkpoint", "report"].includes(kind))
        assert.equal(value.authority, false);
    }
  });

  test("P7 AC3: a main update during integration cannot be reported ready before a fresh pass", async (t) => {
    let called = 0;
    const r = await continuationFixture(t, {
      extendPorts(ports, { f }) {
        const original = ports.integrate;
        ports.integrate = async (q) => {
          const value = await original(q);
          if (++called === 1) f.snapshot.branches[0].sha = "e".repeat(40);
          return value;
        };
      },
    });
    await r.c.accept(r.q(), { drive: false });
    await r.c.tick();
    const stale = await r.c.tick();
    assert(stale.issues.every((i) => i.status !== "review_ready"));
    assert(!r.reports.some((n) => n.kind === "review_ready"));
    const fresh = await r.c.tick();
    assert(fresh.issues.every((i) => i.status === "review_ready"));
    assert.equal(called, 2);
  });
  test("P7 AC4: a new stop supersedes an older pending reconciliation response", async (t) => {
    let entered, release;
    const enteredRead = new Promise((r) => (entered = r)),
      response = new Promise((r) => (release = r));
    const r = await continuationFixture(t, {
      pending: true,
      extendPorts(ports) {
        const original = ports.reconcile;
        ports.reconcile = async (q) => {
          entered();
          await response;
          return original(q);
        };
      },
    });
    await r.c.accept(r.q(), { drive: false });
    await r.c.tick();
    await r.c.stop();
    const recovery = r.c.reconcile();
    await enteredRead;
    await r.c.stop();
    release();
    await recovery;
    const after = await r.c.accept(r.q(), { drive: false });
    assert.notEqual(after.status, "running");
    assert.equal(after.request_status, "rejected");
  });
  test("P7 AC1/4: background drive waits finitely and status leaves it running", async (t) => {
    const r = await continuationFixture(t, {
      change(f, p) {
        f.issue_facts.forEach((i) => (i.blocker = "known"));
        p.limits.monitor_seconds = 1;
      },
    });
    await r.c.accept(r.q(), { wait: false });
    assert.equal((await r.c.accept(r.q("status"))).status, "running");
    const deadline = Date.now() + 5000;
    while ((await r.c.status()).status === "running" && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await r.c.status()).status, "waiting");
    assert.equal(r.starts, 0);
    assert(r.reports.some((r) => r.kind === "finish"));
  });
  test("P7 AC4: stopping a specifically scoped run does not require resending its Issue list", async (t) => {
    const r = await continuationFixture(t, { pending: true });
    await r.c.accept(r.q("continue", { requested_issues: [1] }), {
      drive: false,
    });
    await r.c.tick();
    const stopped = await r.c.accept(r.q("stop"));
    assert.equal(stopped.request_status, "accepted");
    assert.notEqual(stopped.status, "running");
    assert(r.stops > 0);
  });
  test("P7 Security: mutation while source authorization is pending cannot widen a signed request", async (t) => {
    let entered, release;
    const authorizing = new Promise((r) => (entered = r)),
      wait = new Promise((r) => (release = r));
    const r = await continuationFixture(t, {
      extendPorts(ports) {
        const original = ports.authorizeRequest;
        ports.authorizeRequest = async (q) => {
          entered();
          await wait;
          return original(q);
        };
      },
    });
    const request = r.q("continue", { requested_issues: [1] }),
      accepting = r.c.accept(request, { drive: false });
    await authorizing;
    request.requested_issues = [1, 2];
    release();
    await accepting;
    const started = await r.c.tick();
    assert.deepEqual(
      started.issues.map((i) => i.issue_number),
      [1],
    );
  });
}
