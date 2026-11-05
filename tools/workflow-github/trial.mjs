import { performance } from "node:perf_hooks";
import { createAuthorityProvider, verifyRunAuthorization } from "./auth.mjs";
import { executeBrokerOperation } from "./broker.mjs";
import { boundedCall } from "./client.mjs";
import { isLiveRestTransport } from "./transport.mjs";
import { hash, safePath, fail, errorCode, NOT_EVALUATED } from "./core.mjs";

// Explicit controller API. No environment/credential discovery or repository creation.
// prepare/observe are trusted host callbacks; they receive a metered GET-only
// transport and must use it for every trial observation/preparation API request.
export async function runLimitedTrial(config) {
  const receipts = [],
    not_evaluated = [...NOT_EVALUATED, "live_github"];
  let count = 0,
    timer;
  if (!config)
    return {
      status: "not_evaluated",
      request_count: 0,
      receipts,
      not_evaluated,
    };
  const controller = new AbortController(),
    start = performance.now();
  try {
    const c = config;
    if (
      c.enabled !== true ||
      !["live", "synthetic"].includes(c.mode) ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(c.repository) ||
      !Number.isSafeInteger(c.repository_id) ||
      c.repository_id < 1 ||
      !Number.isSafeInteger(c.issue_number) ||
      c.issue_number < 1 ||
      !/^[a-z0-9_-]{1,64}$/.test(c.operation_id) ||
      c.branch !== "ai-work/" + c.issue_number + "/" + c.operation_id ||
      !safePath(c.path) ||
      c.path.startsWith(".github/") ||
      c.path.startsWith("secrets/") ||
      !c.path.endsWith("/" + c.operation_id + ".txt") ||
      typeof c.clock !== "function" ||
      typeof c.prepare !== "function" ||
      typeof c.observe !== "function" ||
      c.journal?.durable !== true ||
      !Array.isArray(c.keys) ||
      !c.transport
    )
      fail("trial_configuration_required");
    if (c.mode === "live" && !isLiveRestTransport(c.transport))
      fail("live_transport_required");
    const transport = {
      kind: c.transport.kind,
      identity: () => c.transport.identity(),
      async request(r) {
        if (
          ++count > 100 ||
          performance.now() - start >= 900000 ||
          controller.signal.aborted
        )
          fail("trial_limit");
        return boundedCall(
          (signal) => c.transport.request({ ...r, signal }),
          10000,
          r.signal
            ? AbortSignal.any([r.signal, controller.signal])
            : controller.signal,
        );
      },
    };
    const readonly = Object.freeze({
      request: (r) => {
        if (r.method !== "GET") fail("trial_callback_write_denied");
        return transport.request(r);
      },
    });
    const provider = createAuthorityProvider({
      mode: "trial",
      keys: c.keys,
      clock: c.clock,
      journal: c.journal,
      observe: (args) =>
        c.observe({
          ...args,
          transport: readonly,
          remaining_api_requests: 100 - count,
        }),
    });
    timer = setTimeout(() => controller.abort(), 900000);
    let expectedHead;
    for (const kind of [
      "create_branch",
      "append_claim",
      "publish_commit",
      "append_record",
      "create_draft_pr",
    ]) {
      const input = await boundedCall(
        (signal) =>
          c.prepare({
            kind,
            expected_head: expectedHead,
            transport: readonly,
            signal,
            remaining_api_requests: 100 - count,
          }),
        10000,
        controller.signal,
      );
      const target = input?.grant?.selected?.[0];
      if (
        input?.policy?.mode !== "trial" ||
        input.policy.repository !== c.repository ||
        input.policy.repository_id !== c.repository_id ||
        input.grant.selected.length !== 1 ||
        target.issue_number !== c.issue_number ||
        (expectedHead && target.head_sha !== expectedHead)
      )
        fail("trial_scope_invalid");
      const auth = await verifyRunAuthorization(input, provider);
      if (!auth.capability) fail("trial_authorization_blocked");
      expectedHead = target.head_sha;
      if (kind === "create_branch") {
        // A limited trial only creates a new file, never overwrites existing source.
        const commit = await readonly.request({
          method: "GET",
          path: "/repos/" + c.repository + "/git/commits/" + expectedHead,
        });
        if (
          commit.status !== 200 ||
          commit.body.sha !== expectedHead ||
          !/^[a-f0-9]{40}$/.test(commit.body.tree?.sha ?? "")
        )
          fail("trial_base_unknown");
        const tree = await readonly.request({
          method: "GET",
          path:
            "/repos/" +
            c.repository +
            "/git/trees/" +
            commit.body.tree.sha +
            "?recursive=1",
        });
        if (
          tree.status !== 200 ||
          tree.body.sha !== commit.body.tree.sha ||
          tree.body.truncated !== false ||
          !Array.isArray(tree.body.tree) ||
          tree.body.tree.some((r) => r.path === c.path)
        )
          fail("trial_path_unavailable");
      }
      const payload =
        kind === "create_branch"
          ? {}
          : kind === "append_claim"
            ? { record_kind: "claim", status: "in_progress" }
            : kind === "append_record"
              ? { record_kind: "report", status: "in_progress" }
              : kind === "create_draft_pr"
                ? { title: "Limited GitHub boundary trial" }
                : {
                    changes: [
                      {
                        path: c.path,
                        action: "set",
                        content: "workflow-github limited trial\n",
                        mode: "100644",
                      },
                    ],
                    created_at: c.clock().replace(/\.\d{3}Z$/, "Z"),
                  };
      const execution = auth.execution;
      const operation = {
        schema_version: 1,
        artifact_kind: "github-operation",
        operation_id: c.operation_id + "-" + kind,
        kind,
        repository: c.repository,
        repository_id: c.repository_id,
        issue_number: c.issue_number,
        run_id: input.grant.run_id,
        claim_id: execution.claim_id,
        worker_id: execution.worker_id,
        generation: execution.generation,
        branch: c.branch,
        expected_head: expectedHead,
        policy_digest: hash(input.policy),
        grant_digest: hash(input.grant),
        stage:
          kind === "create_draft_pr" || kind === "append_record"
            ? "handoff"
            : "implementation",
        payload,
      };
      const receipt = await executeBrokerOperation(operation, auth.capability, {
        transport,
        journal: c.journal,
        authorityProvider: provider,
      });
      receipts.push(receipt);
      if (receipt.status !== "confirmed") fail("trial_operation_unresolved");
      if (kind === "publish_commit") expectedHead = receipt.observed.sha;
    }
    return {
      status: "confirmed",
      mode: c.mode,
      request_count: count,
      receipts,
      not_evaluated:
        c.mode === "live"
          ? not_evaluated.filter((v) => v !== "live_github")
          : not_evaluated,
      cleanup: "human_confirmation_required",
    };
  } catch (error) {
    return {
      status: receipts.some((r) => r.status === "unknown")
        ? "unknown"
        : "blocked",
      request_count: count,
      receipts,
      not_evaluated,
      diagnostics: [{ code: errorCode(error, "trial_failed") }],
      cleanup: "inspect_confirmed_and_unknown_receipts",
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
