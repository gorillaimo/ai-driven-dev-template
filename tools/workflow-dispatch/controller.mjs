import { validateProjectV2 } from "./check.mjs";
import { planBatch } from "./plan.mjs";
import { previewMigration } from "./migrate.mjs";
import { openStore } from "./store.mjs";
import { auditReceipt } from "./recover.mjs";
import { valid } from "./schema.mjs";
import { safe, hash, same, fresh, active, fail, code } from "./core.mjs";
import {
  createAuthorityProvider,
  verifyRunAuthorization,
} from "../workflow-github/auth.mjs";
import { executeBrokerOperation } from "../workflow-github/broker.mjs";
import { validateGitHubArtifact } from "../workflow-github/schema.mjs";
import { isLiveRestTransport } from "../workflow-github/transport.mjs";

// Only host code may configure these ports. JSON, repository text and worker
// results cannot instantiate an authority or reconstruct a task handle.
const authorities = new WeakMap(),
  handles = new WeakMap();
export function createDispatcherAuthority(options) {
  if (
    !options ||
    !["synthetic", "production"].includes(options.mode) ||
    [
      "observe",
      "authorizeMigration",
      "authorizeTask",
      "workerEvidence",
      "authorizeRecovery",
    ].some((k) => typeof options[k] !== "function")
  )
    fail("dispatcher_authority_invalid");
  const value = Object.freeze({});
  authorities.set(value, { ...options });
  return value;
}
export async function openDispatcher({
  directory,
  configuration,
  authority,
  journal,
  transport,
  clock = () => new Date().toISOString(),
}) {
  const ports = authorities.get(authority);
  if (
    !ports ||
    !journal?.durable ||
    typeof journal.latest !== "function" ||
    typeof journal.append !== "function" ||
    typeof transport?.request !== "function" ||
    typeof transport?.identity !== "function" ||
    typeof clock !== "function"
  )
    fail("dispatcher_authority_invalid");
  if (ports.mode === "production" && !isLiveRestTransport(transport))
    fail("production_transport_unavailable");
  const checked = validateProjectV2(configuration);
  if (checked.status !== "passed") fail("project_v2_invalid");
  const config = structuredClone({
      project: configuration.project,
      team: configuration.team,
      deliveryPlan: configuration.deliveryPlan,
    }),
    store = await openStore({ directory, configuration: config });
  const owner = Object.freeze({}),
    not_evaluated = [
      "external_worker_isolation",
      "protected_storage_permissions",
      ...(ports.mode === "synthetic"
        ? ["real_human_identity", "live_github"]
        : []),
    ];
  let tail = Promise.resolve(),
    closed = false,
    poisoned = false;
  const output = (status, extra = {}) => ({
    status,
    mode: ports.mode,
    not_evaluated: [...not_evaluated],
    ...extra,
  });
  const queued = (fn) => {
    const p = tail.then(async () => {
      if (closed || poisoned) fail("dispatcher_unavailable");
      return fn();
    });
    tail = p.catch(() => {});
    return p;
  };
  async function port(name, args) {
    const abort = new AbortController();
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() =>
          ports[name]({ ...args, signal: abort.signal }),
        ),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            poisoned = true;
            abort.abort();
            reject(new Error("port_timeout"));
          }, 10000);
        }),
      ]);
    } catch {
      fail("authority_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
  async function evidence(name, data, extras = []) {
    const binding_digest = hash(data),
      e = await port(name, { ...structuredClone(data), binding_digest });
    const keys = [
      "binding_digest",
      "human_owner",
      "observed_at",
      "evidence_refs",
      ...extras,
    ]
      .sort()
      .join();
    if (
      !safe(e) ||
      Object.keys(e).sort().join() !== keys ||
      e.binding_digest !== binding_digest ||
      !fresh(e.observed_at, clock()) ||
      !Array.isArray(e.evidence_refs) ||
      !e.evidence_refs.length ||
      e.evidence_refs.some(
        (r) =>
          !valid("urn:ai-workflow:execution:v1:common#/$defs/reference", r),
      ) ||
      !config.team.members.some(
        (m) => m.active && m.github_login === e.human_owner,
      )
    )
      fail("authority_evidence_invalid");
    return e;
  }
  function handle(c) {
    const h = Object.freeze({});
    handles.set(h, {
      owner,
      claim_id: c.claim_id,
      worker_id: c.worker_id,
      generation: c.generation,
    });
    return h;
  }
  async function current(h) {
    const binding = handles.get(h);
    if (!binding || binding.owner !== owner) fail("task_handle_invalid");
    const view = await store.view(),
      c = view.claims.find((c) => c.claim_id === binding.claim_id);
    if (
      !c ||
      c.worker_id !== binding.worker_id ||
      c.generation !== binding.generation ||
      c.generation !== view.generation ||
      view.status !== "ready"
    )
      fail("task_generation_invalid");
    return c;
  }
  async function execution(c, branch, expires) {
    const v = await store.view(),
      row = v.claims.find((x) => x.claim_id === c.claim_id),
      run = v.runs.find((r) => r.run_id === c.run_id);
    const stopped =
      v.status !== "ready" ||
      !row ||
      row.worker_id !== c.worker_id ||
      row.generation !== c.generation ||
      v.generation !== c.generation ||
      ["blocked", "reconcile_required", "released"].includes(row?.status) ||
      !run ||
      run.stopped ||
      Date.parse(run.expires_at) <= Date.parse(clock());
    return {
      run_id: c.run_id,
      claim_id: c.claim_id,
      worker_id: c.worker_id,
      generation: c.generation,
      branch: row?.branch ?? branch,
      reserved: !!row && active(row),
      stopped,
      expected_head: row?.head_sha ?? c.head_sha,
      expires_at: new Date(
        Math.min(Date.parse(expires), Date.parse(run?.expires_at ?? expires)),
      ).toISOString(),
    };
  }
  async function authorize(c) {
    const a = await port("authorizeTask", { claim: structuredClone(c) });
    if (
      !a ||
      !safe(a.input) ||
      !Array.isArray(a.issuerKeys) ||
      typeof a.observe !== "function"
    )
      fail("task_authorization_invalid");
    const input = structuredClone(a.input),
      t = input.grant?.selected?.find((t) => t.issue_number === c.issue_number);
    if (
      !t ||
      input.policy?.repository !== config.project.repository ||
      input.policy.repository_id !== config.project.repository_id ||
      input.grant.run_id !== c.run_id ||
      input.grant.human_owner !== c.human_owner ||
      hash(input.profile) !== c.profile_digest ||
      t.contract_digest !== c.contract_digest ||
      t.design_digest !== c.design_digest ||
      t.head_sha !== c.head_sha ||
      !same(t.allowed_paths, c.allowed_paths) ||
      !same(t.forbidden_paths, c.forbidden_paths) ||
      !same(t.stages, c.stages)
    )
      fail("task_authorization_mismatch");
    const branch =
      c.branch ??
      input.policy.branch_prefix + c.issue_number + "/" + c.claim_id;
    let observed;
    const provider = createAuthorityProvider({
      mode: ports.mode === "synthetic" ? "trial" : "production",
      keys: a.issuerKeys,
      clock,
      journal,
      observe: async (context) => {
        const value = await a.observe(context);
        if (!safe(value)) fail("observation_invalid");
        observed = structuredClone(value);
        return {
          ...observed,
          execution: await execution(c, branch, input.grant.expires_at),
        };
      },
    });
    const result = await verifyRunAuthorization(input, provider);
    if (result.artifact.status !== "allowed" || !result.capability) {
      const reason = result.artifact.diagnostics?.[0]?.code;
      fail(
        typeof reason === "string" && /^[a-z0-9_]{1,120}$/.test(reason)
          ? "p3_" + reason
          : "task_authorization_denied",
      );
    }
    await store.bindAuthority({
      claim_id: c.claim_id,
      worker_id: c.worker_id,
      generation: c.generation,
      branch,
      policy_digest: hash(input.policy),
    });
    return {
      input,
      provider,
      capability: result.capability,
      observed,
      branch,
      artifact: result.artifact,
    };
  }
  const api = {
    mode: ports.mode,
    not_evaluated: Object.freeze([...not_evaluated]),
    inspect: () => store.view(),
    migrate: (input) =>
      queued(async () => {
        try {
          const copy = structuredClone(input),
            preview = previewMigration(copy);
          if (
            preview.status !== "passed" ||
            preview.configuration_digest !== checked.configuration_digest
          )
            fail("migration_invalid");
          const proof = await evidence("authorizeMigration", {
            manifest_digest: preview.manifest_digest,
            configuration_digest: checked.configuration_digest,
            inventory_digest: copy.migration.inventory_digest,
          });
          if (
            !config.project.coordinators.assignments.some(
              (x) => x.github_login === proof.human_owner,
            )
          )
            fail("migration_approver_invalid");
          await store.migrate({
            manifest_digest: preview.manifest_digest,
            claims: preview.imported_claims,
            now: clock(),
          });
          return output("passed", { manifest_digest: preview.manifest_digest });
        } catch (e) {
          return output("blocked", {
            diagnostics: [code(e, "migration_failed")],
          });
        }
      }),
    reserve: (request) =>
      queued(async () => {
        const reservations = [],
          diagnostics = [];
        let plan = null;
        try {
          if (!safe(request)) fail("input_invalid");
          const observed = await port("observe", {
            request: structuredClone(request),
          });
          if (!safe(observed)) fail("observation_invalid");
          const input = {
            ...structuredClone(observed),
            requested_issues: request.requested_issues ?? null,
            ledger: await store.view(),
            evaluated_at: clock(),
          };
          plan = planBatch(input);
          if (
            plan.status !== "passed" ||
            plan.configuration_digest !== checked.configuration_digest
          )
            fail("planning_blocked");
          for (const task of plan.selected) {
            const key = hash({
              run_id: input.grant.run_id,
              issue_number: task.issue_number,
              grant_digest: task.grant_digest,
            });
            let c = await store.reserve({
              operation_id: "reserve-" + key.slice(0, 48),
              input_digest: hash({
                task,
                configuration_digest: checked.configuration_digest,
              }),
              run_id: input.grant.run_id,
              claim_id: "claim-" + key.slice(0, 48),
              worker_id: "worker-" + key.slice(0, 48),
              task,
              run_limit: Math.min(10, input.profile.limits.max_issues),
              execution_limit: Math.min(
                2,
                input.profile.limits.max_concurrent_issues,
              ),
              expires_at: new Date(
                Math.min(
                  Date.parse(input.grant.expires_at),
                  Date.parse(clock()) + input.profile.limits.run_seconds * 1000,
                ),
              ).toISOString(),
              now: clock(),
            });
            try {
              await authorize(c);
              c = (await store.view()).claims.find(
                (x) => x.claim_id === c.claim_id,
              );
              reservations.push({ claim: c, handle: handle(c) });
            } catch (e) {
              // Only this live controller knows no send/worker began for a provisional
              // reservation. A crash or any outbox entry instead requires recovery.
              if (
                (await store.operations({ claim_id: c.claim_id })).length === 0
              )
                await store.transition({
                  claim_id: c.claim_id,
                  worker_id: c.worker_id,
                  generation: c.generation,
                  status: "released",
                  head_sha: c.head_sha,
                  execution_stopped: true,
                  now: clock(),
                });
              diagnostics.push(code(e, "task_authorization_denied"));
            }
          }
          return output(diagnostics.length ? "blocked" : "passed", {
            plan,
            reservations,
            diagnostics,
          });
        } catch (e) {
          return output("blocked", {
            plan,
            reservations,
            diagnostics: [...diagnostics, code(e, "reservation_failed")],
          });
        }
      }),
    execute: (h, operation) =>
      queued(async () => {
        let c,
          op,
          begun = false;
        try {
          if (
            !safe(operation) ||
            !validateGitHubArtifact("operation", operation).valid
          )
            fail("operation_invalid");
          op = structuredClone(operation);
          c = await current(h);
          if (
            op.issue_number !== c.issue_number ||
            op.run_id !== c.run_id ||
            op.claim_id !== c.claim_id ||
            op.worker_id !== c.worker_id ||
            op.generation !== c.generation ||
            op.expected_head !== c.head_sha ||
            op.branch !== c.branch
          )
            fail("operation_binding_invalid");
          const a = await authorize(c);
          if (
            op.grant_digest !== hash(a.input.grant) ||
            op.policy_digest !== hash(a.input.policy)
          )
            fail("operation_binding_invalid");
          const record = await store.beginOperation({
            claim_id: c.claim_id,
            worker_id: c.worker_id,
            generation: c.generation,
            operation_id: op.operation_id,
            input_digest: hash(op),
            kind: op.kind,
            actor_id: a.observed.credential.actor_id,
            now: clock(),
          });
          if (record.status === "confirmed")
            return output("confirmed", {
              receipt: journal.latest(op.operation_id),
              diagnostics: [],
            });
          begun = true;
          const receipt = await executeBrokerOperation(op, a.capability, {
            transport,
            journal,
            authorityProvider: a.provider,
          });
          const complete =
            validateGitHubArtifact("receipt", receipt).valid &&
            receipt.input_digest === hash(op) &&
            receipt.claim_id === c.claim_id;
          const status =
            complete &&
            !receipt.partial &&
            ["confirmed", "failed"].includes(receipt.status)
              ? receipt.status
              : "unknown";
          await store.finishOperation({
            claim_id: c.claim_id,
            worker_id: c.worker_id,
            generation: c.generation,
            operation_id: op.operation_id,
            input_digest: hash(op),
            status,
            receipt_digest: complete ? hash(receipt) : null,
            now: clock(),
          });
          if (status === "confirmed" && op.kind === "publish_commit")
            await store.transition({
              claim_id: c.claim_id,
              worker_id: c.worker_id,
              generation: c.generation,
              status: "publishing",
              head_sha: receipt.observed.sha,
              execution_stopped: false,
              now: clock(),
            });
          return output(status, {
            receipt: complete ? receipt : null,
            diagnostics: status === "unknown" ? ["operation_unresolved"] : [],
          });
        } catch (e) {
          if (begun)
            try {
              await store.finishOperation({
                claim_id: c.claim_id,
                worker_id: c.worker_id,
                generation: c.generation,
                operation_id: op.operation_id,
                input_digest: hash(op),
                status: "unknown",
                receipt_digest: null,
                now: clock(),
              });
            } catch {}
          return output(begun ? "unknown" : "failed", {
            diagnostics: [code(e, "operation_failed")],
          });
        }
      }),
    revalidate: (h) =>
      queued(async () => {
        try {
          const c = await current(h);
          const a = await authorize(c);
          return output("passed", { authorization: a.artifact });
        } catch (e) {
          return output("blocked", {
            diagnostics: [code(e, "task_authorization_denied")],
          });
        }
      }),
    handoff: (h) =>
      queued(async () => {
        try {
          const c = await current(h);
          await authorize(c);
          const records = await store.operations({ claim_id: c.claim_id });
          for (const kind of ["create_branch", "append_claim"]) {
            const matches = records.filter(
              (o) => o.kind === kind && o.status === "confirmed",
            );
            let found = false;
            for (const record of matches) {
              const receipt = journal.latest(record.operation_id);
              if (
                kind === "append_claim" &&
                (receipt?.worker_id !== c.worker_id ||
                  receipt?.generation !== c.generation)
              )
                continue;
              await auditReceipt(receipt, record, {
                transport,
                repository: config.project.repository,
                repositoryId: config.project.repository_id,
                claim: c,
                clock,
              });
              found = true;
            }
            if (!found) fail("handoff_incomplete");
          }
          const claim = await store.transition({
            claim_id: c.claim_id,
            worker_id: c.worker_id,
            generation: c.generation,
            status: "ready",
            head_sha: c.head_sha,
            execution_stopped: false,
            now: clock(),
          });
          return output("ready", { claim });
        } catch (e) {
          return output("blocked", {
            diagnostics: [code(e, "handoff_failed")],
          });
        }
      }),
    transition: (h, transition) =>
      queued(async () => {
        try {
          const c = await current(h);
          if (
            !safe(transition) ||
            !valid("urn:ai-workflow:dispatch:v1:transition", transition) ||
            transition.claim_id !== c.claim_id ||
            transition.worker_id !== c.worker_id ||
            transition.generation !== c.generation ||
            transition.head_sha !== c.head_sha ||
            (transition.status === "running" && c.status !== "ready") ||
            !["running", "in_review", "blocked", "released"].includes(
              transition.status,
            )
          )
            fail("transition_invalid");
          const proof = await evidence(
            "workerEvidence",
            { claim: c, transition },
            ["worker_stopped", "release_confirmed"],
          );
          if (
            proof.human_owner !== c.human_owner ||
            typeof proof.worker_stopped !== "boolean" ||
            typeof proof.release_confirmed !== "boolean" ||
            (transition.status === "released" &&
              (!proof.worker_stopped || !proof.release_confirmed))
          )
            fail("worker_evidence_invalid");
          const claim = await store.transition({
            claim_id: c.claim_id,
            worker_id: c.worker_id,
            generation: c.generation,
            status: transition.status,
            head_sha: transition.head_sha,
            execution_stopped: proof.worker_stopped,
            now: clock(),
          });
          return output("passed", { claim });
        } catch (e) {
          return output("blocked", {
            diagnostics: [code(e, "transition_failed")],
          });
        }
      }),
    recover: (request) =>
      queued(async () => {
        try {
          if (
            !safe(request) ||
            Object.keys(request).join() !== "claims" ||
            !Array.isArray(request.claims)
          )
            fail("recovery_invalid");
          const view = await store.view();
          const proof = await evidence(
            "authorizeRecovery",
            { view_digest: hash(view), request },
            ["workers_stopped", "unpublished_reconciled"],
          );
          if (
            proof.workers_stopped !== true ||
            proof.unpublished_reconciled !== true ||
            !config.project.coordinators.assignments.some(
              (x) => x.github_login === proof.human_owner,
            )
          )
            fail("recovery_evidence_missing");
          const operations = [];
          const newHeads = new Map();
          for (const record of view.pending_operations) {
            const c = view.claims.find((c) => c.claim_id === record.claim_id),
              old = journal.latest(record.operation_id);
            if (!old || !c) fail("recovery_journal_missing");
            const audited = await auditReceipt(old, record, {
              transport,
              repository: config.project.repository,
              repositoryId: config.project.repository_id,
              claim: c,
              clock,
            });
            const receipt =
              old.status === "confirmed" ? old : journal.append(audited);
            operations.push({
              operation_id: record.operation_id,
              status: "confirmed",
              receipt_digest: hash(receipt),
            });
            if (record.kind === "publish_commit")
              newHeads.set(c.claim_id, audited.observed.sha);
          }
          for (const choice of request.claims) {
            const c = view.claims.find((c) => c.claim_id === choice.claim_id);
            if (
              !c ||
              choice.head_sha !== (newHeads.get(c.claim_id) ?? c.head_sha) ||
              (choice.action === "resume" && choice.worker_id === c.worker_id)
            )
              fail("recovery_claim_mismatch");
          }
          const next = await store.reconcile({
            claims: structuredClone(request.claims),
            operations,
            now: clock(),
          });
          return output("passed", {
            view: next,
            reservations: next.claims
              .filter((c) =>
                request.claims.some(
                  (x) => x.claim_id === c.claim_id && x.action === "resume",
                ),
              )
              .map((c) => ({ claim: c, handle: handle(c) })),
          });
        } catch (e) {
          return output("blocked", {
            diagnostics: [code(e, "recovery_failed")],
          });
        }
      }),
    // Stop bypasses the work queue so it can fence an in-flight broker's next
    // mutation check. It does not release a claim or assume a worker has exited.
    async stop(run_id) {
      if (typeof run_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(run_id))
        fail("run_invalid");
      return store.stopRun({ run_id, now: clock() });
    },
    async close() {
      await tail;
      closed = true;
      await store.close();
    },
  };
  return Object.freeze(api);
}
