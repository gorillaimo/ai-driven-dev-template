import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  bounded,
  code,
  error,
  fail,
  fresh,
  hash,
  safe,
  within,
} from "./core.mjs";
import { checkProfile } from "./core.mjs";
import { valid } from "./core.mjs";
import { inspectTicket, verifyRequest } from "./authority.mjs";
import { inspectAdapter, requiredCapabilities } from "./adapter.mjs";
import {
  collectArtifacts,
  inspectWorkspace,
  restoreWorkspace,
} from "./workspace.mjs";
import { validateExecutionArtifact } from "../workflow-execution/schema.mjs";
import { checkExecutionEvidence } from "../workflow-execution/check.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// supervisor
const id = (prefix) => prefix + "-" + randomUUID();
export async function openSupervisor({
  directory,
  profile,
  authority,
  adapter,
  dispatcher,
  prepareTask,
  evaluate,
  publishTask,
  mode,
  clock = () => new Date().toISOString(),
}) {
  if (
    !["synthetic", "production"].includes(mode) ||
    checkProfile(profile, clock()).status !== "passed" ||
    !dispatcher ||
    ["inspect", "handoff", "stop"].some(
      (k) => typeof dispatcher[k] !== "function",
    ) ||
    typeof prepareTask !== "function" ||
    typeof evaluate !== "function" ||
    (mode === "production" && typeof dispatcher.revalidate !== "function") ||
    (mode === "production" && typeof publishTask !== "function")
  )
    fail("supervisor_configuration_invalid");
  const p = structuredClone(profile),
    ports = inspectAdapter(adapter, mode),
    ledger = await openLedger({ directory, profile: p }),
    active = new Map(),
    startups = new Map(),
    inflight = new Map(),
    cancelled = new Set(),
    reports = new Map(),
    reconciledRuns = new Set(),
    resumeWork = new Map();
  let closed = false;
  const not_evaluated =
    mode === "synthetic"
      ? ["real_human_identity", "live_provider", "production_adoption"]
      : [];
  const output = (status, extra = {}) => ({
    status,
    mode,
    profile_digest: hash(p),
    not_evaluated: [...not_evaluated],
    ...extra,
  });
  function readPrivate(path) {
    const fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const st = fstatSync(fd);
      if (
        !st.isFile() ||
        st.nlink !== 1 ||
        st.uid !== process.getuid() ||
        st.mode & 0o077 ||
        st.size > 100 * 1024 * 1024
      )
        fail("artifact_storage_unsafe");
      const value = JSON.parse(readFileSync(fd, "utf8"));
      if (!safe(value)) fail("artifact_invalid");
      return value;
    } finally {
      closeSync(fd);
    }
  }
  function durable(path, value, { replace = false } = {}) {
    const target = replace ? path + "." + randomUUID() + ".tmp" : path,
      fd = openSync(target, "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(value));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (replace) renameSync(target, path);
    const d = openSync(directory, "r");
    try {
      fsyncSync(d);
    } finally {
      closeSync(d);
    }
  }
  function reportFor(run_id) {
    if (reports.has(run_id)) return reports.get(run_id);
    const path = join(directory, run_id + ".result.json");
    if (!existsSync(path)) return null;
    const value = readPrivate(path);
    if (
      !valid("result", value) ||
      value.profile_digest !== hash(p) ||
      value.run_id !== run_id
    )
      fail("report_binding_invalid");
    return value;
  }
  function artifactFor(a) {
    const value = readPrivate(join(directory, a.attempt_id + ".artifact.json")),
      { digest, ...content } = value;
    if (
      digest !== a.artifact_digest ||
      hash(content) !== digest ||
      value.execution.attempt_id !== a.attempt_id ||
      value.execution.context_id !== a.context_id
    )
      fail("artifact_binding_invalid");
    return value;
  }
  async function claimFor(task, run_id) {
    const v = await bounded(() => dispatcher.inspect()),
      c = v.claims?.find((c) => c.claim_id === task.claim_id);
    if (
      v.status !== "ready" ||
      !c ||
      v.generation !== c.generation ||
      c.run_id !== run_id ||
      c.profile_digest !== p.execution_profile_digest ||
      c.policy_digest !== p.policy_digest ||
      c.human_owner !== p.human_owner ||
      !["ready", "running", "publishing"].includes(c.status) ||
      c.allowed_paths.some((x) => !within(x, p.write_paths)) ||
      p.forbidden_paths.some((x) => !c.forbidden_paths.includes(x))
    )
      fail("claim_binding_invalid");
    if (typeof dispatcher.revalidate === "function") {
      const r = await bounded(() => dispatcher.revalidate(task.handle));
      if (r.status !== "passed") fail("authority_revoked");
    }
    return c;
  }
  async function keepArtifact(attempt, w, observed = null) {
    const snapshot = collectArtifacts(w),
      content = {
        files: snapshot.files,
        bytes: snapshot.bytes,
        source_digest: snapshot.digest,
        execution: {
          attempt_id: attempt.attempt_id,
          context_id: attempt.context_id,
          role: attempt.role,
          result: observed,
        },
      };
    content.digest = hash(content);
    const raw = JSON.stringify(content);
    if (
      Buffer.byteLength(raw) > 100 * 1024 * 1024 ||
      readdirSync(directory)
        .filter((n) => n.endsWith(".artifact.json"))
        .reduce((n, file) => n + lstatSync(join(directory, file)).size, 0) +
        Buffer.byteLength(raw) >
        1024 * 1024 * 1024
    )
      fail("artifact_limit");
    const path = join(directory, attempt.attempt_id + ".artifact.json"),
      fd = openSync(path, "wx", 0o600);
    try {
      writeFileSync(fd, raw);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const d = openSync(directory, "r");
    try {
      fsyncSync(d);
    } finally {
      closeSync(d);
    }
    return content;
  }
  async function stage(task, run_id, role, cycle, history) {
    const c = await claimFor(task, run_id);
    if (cancelled.has(run_id)) fail("run_stopped");
    if (
      !c.stages?.includes(
        role === "implementation" ? "implementation" : "validation",
      )
    )
      fail("stage_unapproved");
    const a = await ledger.reserve({
      attempt_id: id("attempt"),
      run_id,
      claim_id: c.claim_id,
      worker_id: c.worker_id,
      generation: c.generation,
      issue_number: c.issue_number,
      role,
      context_id: id("context"),
      head_sha: c.head_sha,
      now: clock(),
    });
    let h,
      w,
      starting = false;
    try {
      const prepared = await bounded((signal) =>
        prepareTask({
          claim: structuredClone(c),
          attempt: structuredClone(a),
          profile: structuredClone(p),
          role,
          cycle,
          history: structuredClone(history),
          signal,
        }),
      );
      const recovery =
        role === "implementation" ? resumeWork.get(c.claim_id) : null;
      w = recovery?.workspace ?? prepared?.workspace;
      const wp = inspectWorkspace(w);
      if (
        hash({ ...wp.profile, write_paths: p.write_paths }) !== hash(p) ||
        wp.profile.write_paths.some((x) => !within(x, c.allowed_paths))
      )
        fail("workspace_claim_mismatch");
      let command = prepared.command;
      if (role === "verification") {
        const ep = prepared.execution_profile;
        if (
          !safe(ep) ||
          !validateExecutionArtifact("profile", ep).valid ||
          hash(ep) !== p.execution_profile_digest
        )
          fail("verification_profile_unbound");
        const approved = ep.commands.find(
          (x) => x.command_id === prepared.command_id,
        );
        if (!approved) fail("verification_command_unbound");
        command = { executable: approved.executable, argv: approved.argv };
      }
      if (closed || cancelled.has(run_id)) fail("run_stopped");
      durable(join(directory, a.attempt_id + ".workspace.json"), {
        profile_digest: hash(p),
        directory: wp.directory,
        read_files_digest: w.read_files_digest,
        workspace_profile: wp.profile,
      });
      starting = true;
      const startup = bounded((signal) =>
        (recovery?.resume_token
          ? ports.resume.bind(ports)
          : ports.start.bind(ports))({
          resume_token: recovery?.resume_token,
          attempt: a,
          workspace: w,
          profile: p,
          role,
          context_id: a.context_id,
          prompt: prepared.prompt,
          command,
          signal,
          onCreated: async (container_id) =>
            ledger.observe({
              attempt_id: a.attempt_id,
              epoch: a.epoch,
              status: "starting",
              container_id,
              stopped: false,
              artifact_digest: null,
              now: clock(),
            }),
        }),
      );
      startups.set(a.attempt_id, { run_id, promise: startup });
      try {
        h = await startup;
      } catch (e) {
        startups.delete(a.attempt_id);
        throw e;
      }
      if (recovery) resumeWork.delete(c.claim_id);
      active.set(a.attempt_id, {
        attempt: a,
        handle: h,
        workspace: w,
        run_id,
        task,
      });
      startups.delete(a.attempt_id);
      if (cancelled.has(run_id)) await bounded(() => ports.stop(h));
      const r = await bounded(
        (signal) => ports.observe(h, { signal }),
        p.limits.call_seconds * 1000 + 10000,
      );
      if (
        !safe(r) ||
        r.context_id !== a.context_id ||
        typeof r.stopped !== "boolean"
      )
        fail("adapter_result_invalid");
      if (!r.stopped) fail("worker_stop_unknown");
      const artifact = await keepArtifact(a, w, r);
      const old = (await ledger.view()).attempts.find(
        (v) => v.attempt_id === a.attempt_id,
      );
      const stopped = cancelled.has(run_id),
        status = stopped
          ? "stopped"
          : r.status === "completed"
            ? "completed"
            : r.status === "failed"
              ? "failed"
              : "unknown";
      const saved = await ledger.observe({
        attempt_id: a.attempt_id,
        epoch: a.epoch,
        status,
        container_id: old.container_id,
        stopped: true,
        artifact_digest: artifact.digest,
        now: clock(),
      });
      active.delete(a.attempt_id);
      history.push(saved);
      if (stopped) fail("run_stopped");
      if (
        status !== "completed" &&
        !(
          role === "verification" &&
          status === "failed" &&
          Number.isInteger(r.output?.exit_code) &&
          r.output.exit_code !== 0 &&
          Number.isInteger(r.output?.test_count) &&
          r.output.test_count >= 0
        )
      )
        fail("worker_failed");
      return {
        claim: c,
        attempt: saved,
        artifact,
        workspace: w,
        result: r.output ?? {},
      };
    } catch (e) {
      if (!starting) {
        await ledger
          .observe({
            attempt_id: a.attempt_id,
            epoch: a.epoch,
            status: "stopped",
            container_id: null,
            stopped: true,
            artifact_digest: null,
            now: clock(),
          })
          .catch(() => {});
      }
      if (h) {
        try {
          const stopped = await bounded(() => ports.stop(h), 10000);
          if (stopped?.stopped && w) {
            const artifact = await keepArtifact(a, w).catch(() => null),
              old = (await ledger.view()).attempts.find(
                (v) => v.attempt_id === a.attempt_id,
              );
            if (!old.stopped)
              await ledger.observe({
                attempt_id: a.attempt_id,
                epoch: a.epoch,
                status: "stopped",
                container_id: old.container_id,
                stopped: true,
                artifact_digest: artifact?.digest ?? null,
                now: clock(),
              });
            active.delete(a.attempt_id);
          }
        } catch {}
      }
      throw e;
    }
  }
  async function pipeline(ticket, tasks) {
    const t = inspectTicket(ticket, authority, p),
      run_id = t.request.run_id,
      history = [];
    let polling = false;
    const monitor = setInterval(async () => {
      if (polling || cancelled.has(run_id)) return;
      polling = true;
      try {
        for (const task of tasks) await claimFor(task, run_id);
        const view = await ledger.view(),
          r = view.runs.find((r) => r.run_id === run_id);
        if (!r || r.stopped || Date.parse(r.expires_at) <= Date.parse(clock()))
          fail("run_expired");
      } catch {
        cancelled.add(run_id);
        await ledger.fence({ run_id, now: clock() }).catch(() => {});
        await bounded(() => dispatcher.stop(run_id)).catch(() => {});
        await Promise.allSettled(
          [...active.values()]
            .filter((x) => x.run_id === run_id)
            .map((x) => bounded(() => ports.stop(x.handle), 10000)),
        );
      } finally {
        polling = false;
      }
    }, 15000);
    try {
      const capability = await bounded(
        () => ports.probe({ profile: p }),
        Math.min(60000, p.limits.call_seconds * 1000),
      );
      if (
        !valid("capability", capability) ||
        !fresh(capability.observed_at, clock()) ||
        !requiredCapabilities(capability, p, mode)
      )
        fail("adapter_capability_missing");
      const runTask = async (task) => {
        const taskHistory = [];
        try {
          const c = await claimFor(task, run_id);
          if (
            !Array.isArray(c.stages) ||
            !["implementation", "validation"].every((stage) =>
              c.stages.includes(stage),
            )
          )
            fail("pipeline_stages_unapproved");
          let previousFailure = null;
          const handed = await bounded(() => dispatcher.handoff(task.handle));
          if (handed.status !== "ready") fail("handoff_unverified");
          for (let cycle = 0; cycle <= p.limits.max_repairs; cycle++) {
            const implementation = await stage(
              task,
              run_id,
              "implementation",
              cycle,
              taskHistory,
            );
            const before = inspectWorkspace(implementation.workspace)
              .files.filter((f) => within(f.path, p.write_paths))
              .sort((a, b) => a.path.localeCompare(b.path, "en"));
            if (hash(before) !== hash(implementation.artifact.files)) {
              if (typeof publishTask !== "function")
                fail("publication_required");
              await bounded(
                (signal) =>
                  publishTask({
                    claim: implementation.claim,
                    handle: task.handle,
                    artifact: implementation.artifact,
                    signal,
                  }),
                p.limits.call_seconds * 1000,
              );
              const published = await claimFor(task, run_id);
              if (published.head_sha === implementation.claim.head_sha)
                fail("publication_unconfirmed");
            }
            const verification = await stage(
                task,
                run_id,
                "verification",
                cycle,
                taskHistory,
              ),
              review = await stage(task, run_id, "review", cycle, taskHistory),
              current = await claimFor(task, run_id);
            const evaluated = await bounded((signal) =>
              evaluate({
                claim: current,
                implementation: { ...implementation, workspace: undefined },
                verification: { ...verification, workspace: undefined },
                review: { ...review, workspace: undefined },
                attempts: structuredClone(taskHistory),
                cycle,
                signal,
              }),
            );
            if (!safe(evaluated) || !evaluated.input)
              return output("blocked", {
                run_id,
                attempts: taskHistory,
                diagnostics: ["evidence_not_evaluated"],
              });
            const checked = checkRunnerEvidence({
              input: evaluated.input,
              attempts: taskHistory,
              claim: current,
              profile: p,
              now: clock(),
              artifacts: taskHistory
                .filter((a) => a.artifact_digest)
                .map(artifactFor),
            });
            if (checked.status === "passed") break;
            const failure = hash({
              files: implementation.artifact.files,
              verification: {
                exit_code: verification.result.exit_code,
                test_count: verification.result.test_count,
              },
              review: review.result.message ?? review.result.findings ?? null,
              diagnostics: checked.diagnostics,
            });
            if (failure === previousFailure)
              return output("blocked", {
                run_id,
                attempts: taskHistory,
                diagnostics: ["repair_no_progress"],
              });
            previousFailure = failure;
            if (
              cycle === p.limits.max_repairs ||
              evaluated.repairable !== true ||
              ["failed", "blocked", "awaiting_approval"].includes(
                evaluated.workflow_status,
              )
            )
              return output("blocked", {
                run_id,
                attempts: taskHistory,
                diagnostics: checked.diagnostics,
              });
          }
          return output("passed", { run_id, attempts: taskHistory });
        } catch (e) {
          return output(cancelled.has(run_id) ? "stopped" : "blocked", {
            run_id,
            attempts: taskHistory,
            diagnostics: [code(e)],
          });
        }
      };
      const results = [];
      if (p.limits.max_ai_workers < 2) {
        for (const task of tasks) results.push(await runTask(task));
      } else results.push(...(await Promise.all(tasks.map(runTask))));
      history.push(...results.flatMap((r) => r.attempts));
      if (results.some((r) => r.status !== "passed"))
        return output(cancelled.has(run_id) ? "stopped" : "blocked", {
          run_id,
          attempts: history,
          diagnostics: [
            ...new Set(results.flatMap((r) => r.diagnostics ?? [])),
          ],
        });
      return output("passed", { run_id, attempts: history });
    } catch (e) {
      return output(cancelled.has(run_id) ? "stopped" : "blocked", {
        run_id,
        attempts: history,
        diagnostics: [code(e)],
      });
    } finally {
      clearInterval(monitor);
    }
  }
  const api = {
    inspect: () => ledger.view(),
    async accept(envelope, tasks = [], { wait = true } = {}) {
      if (closed) fail("supervisor_closed");
      let t;
      try {
        const verified = await verifyRequest(authority, envelope, p);
        if (verified.mode !== mode) fail("authority_mode_mismatch");
        t = inspectTicket(verified.ticket, authority, p);
        const run_id = t.request.run_id;
        if (t.request.intent === "status")
          return output(inflight.has(run_id) ? "running" : "passed", {
            run_id,
            view: await ledger.view(),
            report: reportFor(run_id),
          });
        const q = {
          event_id: t.request.event_id,
          nonce: t.request.nonce,
          run_id,
          intent: t.request.intent,
          request_digest: hash(t.request),
          now: clock(),
        };
        if (t.request.intent === "stop") {
          cancelled.add(run_id);
          const fences = await Promise.allSettled([
            ledger.admit(q),
            bounded(() => dispatcher.stop(run_id)),
          ]);
          const pendingStarts = await Promise.allSettled(
            [...startups.values()]
              .filter((x) => x.run_id === run_id)
              .map((x) => bounded(() => x.promise, 10000)),
          );
          const stops = await Promise.allSettled(
            [...active.values()]
              .filter((x) => x.run_id === run_id)
              .map((x) => bounded(() => ports.stop(x.handle), 10000)),
          );
          return output(
            [...fences, ...pendingStarts, ...stops].some(
              (s) => s.status === "rejected",
            ) || stops.some((s) => !s.value?.stopped)
              ? "unknown"
              : "stopped",
            { run_id },
          );
        }
        if (inflight.has(run_id))
          return output(cancelled.has(run_id) ? "stopped" : "running", {
            run_id,
          });
        const admitted = await ledger.admit(q);
        if (inflight.has(run_id))
          return output(cancelled.has(run_id) ? "stopped" : "running", {
            run_id,
          });
        if (admitted.duplicate)
          return (
            reportFor(run_id) ??
            output("blocked", {
              run_id,
              diagnostics: ["request_already_admitted"],
            })
          );
        if (admitted.stopped) {
          if (!reconciledRuns.has(run_id)) fail("run_requires_reconciliation");
          await ledger.resumeRun({ run_id, now: clock() });
          cancelled.delete(run_id);
          reconciledRuns.delete(run_id);
        }
        const work = (async () => {
          let selected = tasks;
          if (typeof tasks === "function")
            selected = await bounded((signal) =>
              tasks({ request: structuredClone(t.request), signal }),
            );
          if (
            !Array.isArray(selected) ||
            selected.length > 2 ||
            selected.some((x) => !x || typeof x.claim_id !== "string") ||
            new Set(selected.map((x) => x.claim_id)).size !== selected.length
          )
            fail("task_list_invalid");
          return pipeline(verified.ticket, selected);
        })().catch((e) =>
          output("blocked", { run_id, diagnostics: [code(e)] }),
        );
        inflight.set(run_id, work);
        const completed = work
          .then((result) => {
            const record = {
              schema_version: 1,
              artifact_kind: "runner-result",
              status: result.status,
              mode,
              run_id,
              profile_digest: hash(p),
              attempts: result.attempts ?? [],
              diagnostics: result.diagnostics ?? [],
              not_evaluated: [...not_evaluated],
              evidence_refs: [],
            };
            if (!valid("result", record)) fail("report_invalid");
            durable(join(directory, run_id + ".result.json"), record, {
              replace: true,
            });
            reports.set(run_id, record);
            return record;
          })
          .finally(() => inflight.delete(run_id));
        if (!wait) {
          void completed.catch(() => {});
          return output("running", { run_id });
        }
        return await completed;
      } catch (e) {
        return output("blocked", {
          run_id: t?.request.run_id ?? null,
          diagnostics: [code(e)],
        });
      }
    },
    async reconcile(tasks) {
      try {
        if (
          closed ||
          inflight.size ||
          !Array.isArray(tasks) ||
          tasks.length > 2 ||
          typeof ports.recoverStop !== "function"
        )
          fail("recovery_configuration_invalid");
        const view = await ledger.view(),
          proofs = [],
          resumable = [];
        for (const a of view.attempts.filter((a) => !a.stopped)) {
          const task = tasks.find((t) => t.claim_id === a.claim_id);
          if (!task) fail("recovery_claim_missing");
          const c = await claimFor(task, a.run_id);
          if (
            c.issue_number !== a.issue_number ||
            c.head_sha !== a.head_sha ||
            c.generation < a.generation
          )
            fail("recovery_claim_changed");
          const meta = readPrivate(
            join(directory, a.attempt_id + ".workspace.json"),
          );
          if (
            meta.profile_digest !== hash(p) ||
            typeof meta.directory !== "string"
          )
            fail("recovery_workspace_invalid");
          const workspaceProfile = meta.workspace_profile ?? p;
          if (
            hash({ ...workspaceProfile, write_paths: p.write_paths }) !==
              hash(p) ||
            workspaceProfile.write_paths.some(
              (path) => !within(path, c.allowed_paths),
            )
          )
            fail("recovery_workspace_scope_changed");
          const workspace = restoreWorkspace({
            directory: meta.directory,
            profile: workspaceProfile,
          });
          if (workspace.read_files_digest !== meta.read_files_digest)
            fail("recovery_workspace_invalid");
          const stopped = await bounded(
            () => ports.recoverStop(a, { workspace }),
            15000,
          );
          if (!stopped?.stopped) fail("recovery_stop_unknown");
          let artifact;
          if (a.artifact_digest) {
            artifact = artifactFor(a);
            if (artifact.source_digest !== collectArtifacts(workspace).digest)
              fail("recovery_artifact_changed");
          } else artifact = await keepArtifact(a, workspace);
          proofs.push({
            attempt_id: a.attempt_id,
            artifact_digest: artifact.digest,
          });
          if (stopped.resume_token && typeof ports.resume === "function")
            resumable.push([
              c.claim_id,
              { workspace, resume_token: stopped.resume_token },
            ]);
        }
        // Unknown provider usage is never settled from a worker's assertion.
        if (view.usage.some((u) => ["reserved", "unknown"].includes(u.status)))
          fail("usage_unknown");
        await ledger.recover({ attempts: proofs, now: clock() });
        for (const task of tasks) {
          const c = (await bounded(() => dispatcher.inspect())).claims?.find(
            (c) => c.claim_id === task.claim_id,
          );
          if (!c) fail("recovery_claim_missing");
          await claimFor(task, c.run_id);
          reconciledRuns.add(c.run_id);
        }
        for (const [claim, state] of resumable) resumeWork.set(claim, state);
        return output("passed", {
          diagnostics: [],
          not_evaluated: [...not_evaluated, "fresh_continuation_required"],
        });
      } catch (e) {
        return output("blocked", { diagnostics: [code(e)] });
      }
    },
    modelPorts() {
      return {
        ledger: {
          reserveUsage: (q) => ledger.reserveUsage(q),
          settleUsage: (q) => ledger.settleUsage(q),
        },
        observeAttempt: async (attempt_id) => {
          const running = active.get(attempt_id),
            view = await ledger.view(),
            a = view.attempts.find((a) => a.attempt_id === attempt_id),
            run = view.runs.find((r) => r.run_id === a?.run_id);
          if (!running || !a || !run)
            return {
              attempt_id,
              active: false,
              stopped: true,
              epoch: view.epoch,
              run_id: a?.run_id ?? "unknown",
            };
          const current = await claimFor(running.task, running.run_id);
          return {
            attempt_id,
            run_id: a.run_id,
            epoch: view.epoch,
            active:
              !a.stopped &&
              a.worker_id === current.worker_id &&
              a.generation === current.generation,
            stopped:
              cancelled.has(a.run_id) ||
              run.stopped ||
              Date.parse(run.expires_at) <= Date.parse(clock()),
          };
        },
      };
    },
    async workerEvidence({ claim, binding_digest }) {
      const view = await ledger.view(),
        attempts = view.attempts.filter(
          (a) =>
            a.claim_id === claim.claim_id &&
            a.worker_id === claim.worker_id &&
            a.generation === claim.generation,
        );
      for (const a of attempts.filter((a) => a.artifact_digest)) artifactFor(a);
      return {
        binding_digest,
        human_owner: p.human_owner,
        observed_at: clock(),
        evidence_refs: attempts
          .filter((a) => a.artifact_digest)
          .map((a) => ({
            kind: "source",
            id: a.attempt_id,
            revision: 1,
            digest: a.artifact_digest,
            location: { kind: "id", target: a.attempt_id },
          })),
        worker_stopped:
          attempts.length > 0 &&
          attempts.every((a) => a.stopped && !!a.artifact_digest),
        release_confirmed: false,
      };
    },
    async close() {
      closed = true;
      for (const run_id of inflight.keys()) {
        cancelled.add(run_id);
        await ledger.fence({ run_id, now: clock() }).catch(() => {});
      }
      for (const x of active.values())
        await bounded(() => ports.stop(x.handle), 10000).catch(() => {});
      await Promise.allSettled([...inflight.values()]);
      await ledger.close();
    },
  };
  return Object.freeze(api);
}

// evidence
export function checkRunnerEvidence({
  input,
  attempts,
  claim,
  profile,
  now,
  artifacts = [],
}) {
  if (
    !safe(input) ||
    !safe(attempts) ||
    input.context?.repository !== profile.repository ||
    input.context?.subject?.issue_number !== claim.issue_number ||
    input.context?.subject?.run_id !== claim.run_id ||
    input.context?.subject?.head_sha !== claim.head_sha ||
    hash(input.profile) !== profile.execution_profile_digest ||
    input.context.evaluated_at !== now
  )
    fail("evidence_binding_invalid");
  const result = checkExecutionEvidence(input);
  if (result.status !== "pass")
    return {
      status: "blocked",
      diagnostics: result.diagnostics.map((d) => d.code),
      checker: result,
    };
  attempts = attempts.filter(
    (a) =>
      a.claim_id === claim.claim_id &&
      a.worker_id === claim.worker_id &&
      a.generation === claim.generation &&
      a.run_id === claim.run_id &&
      a.issue_number === claim.issue_number &&
      a.head_sha === claim.head_sha &&
      a.profile_digest === hash(profile),
  );
  function actual(a) {
    const v = artifacts.find((v) => v.digest === a.artifact_digest);
    if (!v || !safe(v)) fail("actual_evidence_missing");
    const { digest, ...content } = v;
    if (
      hash(content) !== digest ||
      v.execution?.attempt_id !== a.attempt_id ||
      v.execution.context_id !== a.context_id ||
      v.execution.role !== a.role ||
      v.execution.result?.status !== "completed" ||
      !v.execution.result.stopped
    )
      fail("actual_evidence_unbound");
    return v.execution.result.output;
  }
  for (const verification of input.verifications.filter(
    (v) =>
      v.subject.issue_number === claim.issue_number &&
      v.subject.head_sha === claim.head_sha,
  ))
    if (
      !attempts.some(
        (a) =>
          a.role === "verification" &&
          a.status === "completed" &&
          a.stopped &&
          verification.log_refs.some((r) => r.digest === a.artifact_digest),
      )
    )
      fail("verification_log_unbound");
  for (const v of input.verifications.filter(
    (v) =>
      v.subject.issue_number === claim.issue_number &&
      v.subject.head_sha === claim.head_sha,
  )) {
    const a = attempts.find(
        (a) =>
          a.role === "verification" &&
          v.log_refs.some((r) => r.digest === a.artifact_digest),
      ),
      observed = actual(a),
      command = input.profile.commands.find(
        (c) => c.command_id === v.command_id,
      );
    if (
      observed.exit_code !== v.exit_code ||
      observed.exit_code !== 0 ||
      observed.test_count !== v.test_count ||
      !command ||
      hash(observed.command) !==
        hash({ executable: command.executable, argv: command.argv })
    )
      fail("verification_observation_mismatch");
  }
  const reviews = input.reviews.filter(
    (r) =>
      r.subject.issue_number === claim.issue_number &&
      r.subject.head_sha === claim.head_sha,
  );
  for (const r of reviews) {
    const impl = attempts.find(
        (a) =>
          a.role === "implementation" &&
          a.context_id === r.implementer.context_id,
      ),
      review = attempts.find(
        (a) => a.role === "review" && a.context_id === r.reviewer.context_id,
      );
    if (
      !impl ||
      !review ||
      impl.attempt_id === review.attempt_id ||
      impl.context_id === review.context_id ||
      [impl, review].some(
        (a) => a.status !== "completed" || !a.stopped || !a.artifact_digest,
      ) ||
      !r.evidence_refs.some((ref) => ref.digest === review.artifact_digest) ||
      !validateExecutionArtifact("review", r).valid
    )
      fail("review_execution_missing");
    let reported;
    try {
      reported = JSON.parse(actual(review).message);
    } catch {
      fail("review_output_invalid");
    }
    if (!safe(reported)) fail("review_output_invalid");
    // The host adds the durable raw-output reference after the model returns.
    const { evidence_refs: ignoredReported, ...reportedContent } = reported,
      { evidence_refs: ignoredRecord, ...recordContent } = r;
    if (hash(reportedContent) !== hash(recordContent))
      fail("review_output_mismatch");
    actual(impl);
  }
  if (
    !attempts.some(
      (a) =>
        a.role === "verification" &&
        a.status === "completed" &&
        a.stopped &&
        a.artifact_digest,
    )
  )
    fail("verification_execution_missing");
  return { status: "passed", diagnostics: [], checker: result };
}

// ledger
export async function openLedger({ directory, profile }) {
  if (
    typeof directory !== "string" ||
    resolve(directory) !== directory ||
    checkProfile(
      profile,
      profile?.model?.pricing_expires_at
        ? new Date(
            Date.parse(profile.model.pricing_expires_at) - 1,
          ).toISOString()
        : "",
    ).status !== "passed"
  )
    fail("ledger_configuration_invalid");
  const child = spawn(
    "python3",
    [
      fileURLToPath(new URL("./ledger_server.py", import.meta.url)),
      directory,
      fileURLToPath(new URL("../../", import.meta.url)),
    ],
    {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        LANG: "C.UTF-8",
        PYTHONNOUSERSITE: "1",
        PYTHONDONTWRITEBYTECODE: "1",
      },
    },
  );
  let next = 0,
    buffer = "",
    dead = false,
    closed = false,
    stderr = 0;
  const pending = new Map();
  const poison = () => {
    if (dead) return;
    dead = true;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(error("ledger_unavailable"));
    }
    pending.clear();
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 500);
    timer.unref();
  };
  child.on("error", poison);
  child.on("exit", () => {
    closed = true;
    poison();
  });
  child.stdin.on("error", poison);
  child.stderr.on("data", (b) => {
    stderr += b.length;
    if (stderr > 1048576) poison();
  });
  child.stdout.on("data", (b) => {
    buffer += b.toString("utf8");
    if (Buffer.byteLength(buffer) > 2097152) {
      poison();
      return;
    }
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      try {
        if (Buffer.byteLength(line) > 1048576) throw Error();
        const row = JSON.parse(line),
          p = pending.get(row.id);
        if (
          !safe(row) ||
          !p ||
          Object.keys(row).sort().join() !==
            (row.ok ? "id,ok,value" : "error,id,ok")
        )
          throw Error();
        pending.delete(row.id);
        clearTimeout(p.timer);
        row.ok
          ? p.resolve(row.value)
          : p.reject(
              error(
                /^[a-z0-9_]{1,128}$/.test(row.error)
                  ? row.error
                  : "ledger_unavailable",
              ),
            );
      } catch {
        poison();
      }
    }
  });
  function rpc(command, data, id = ++next) {
    if (dead || !safe(data) || pending.size >= 64)
      return Promise.reject(error("ledger_unavailable"));
    const raw = JSON.stringify({ id, command, data }) + "\n";
    if (Buffer.byteLength(raw) > 1048576)
      return Promise.reject(error("frame_limit"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(poison, 6000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(raw);
    });
  }
  try {
    await rpc("initialize", { profile_digest: hash(profile), profile }, 0);
  } catch (e) {
    poison();
    throw e;
  }
  return {
    fence: (q) => rpc("fence", q),
    resumeRun: (q) => rpc("resume_run", q),
    view: () => rpc("view", {}),
    admit: (q) => rpc("admit", q),
    reserve: (q) => rpc("reserve", q),
    observe: (q) => rpc("observe", q),
    reserveUsage: (q) => rpc("reserve_usage", q),
    settleUsage: (q) => rpc("settle_usage", q),
    recover: (q) => rpc("recover", q),
    async close() {
      if (closed) return;
      try {
        await rpc("close", {});
      } finally {
        child.stdin.end();
        await new Promise((resolve) => {
          if (closed) return resolve();
          const timer = setTimeout(() => {
            poison();
            resolve();
          }, 1000);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    },
  };
}
