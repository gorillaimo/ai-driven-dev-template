import { mkdirSync, lstatSync } from "node:fs";
import {
  createGitHubAppTokenProvider,
  createRestTransport,
} from "./transport.mjs";
import { createTrialBudget } from "./actions-budget.mjs";
import { createTrialRecordFactory } from "./actions-records.mjs";
import { createFileJournal } from "./journal.mjs";
import { removeTrialKey } from "./actions-io.mjs";
import { collectGitHubSnapshot, contractDigest } from "./collector.mjs";
import { createClient } from "./client.mjs";
import { runLimitedTrial } from "./trial.mjs";
import { validateGitHubArtifact } from "./schema.mjs";
import {
  badJson,
  hash,
  same,
  fail,
  errorCode,
  NOT_EVALUATED,
} from "./core.mjs";

function assertManifest(m) {
  if (
    badJson(m) ||
    m?.version !== 1 ||
    m.host?.repository !== "gorillaimo/ai-driven-dev-template" ||
    m.host.repository_id !== 1225812134 ||
    m.target?.repository !== "gorillaimo/ai-driven-dev-template-sandbox" ||
    m.target.repository_id !== 1446360916 ||
    m.target.issue_number !== 1 ||
    m.target.owner?.id !== 12776447 ||
    m.target.owner.login !== "gorillaimo" ||
    m.target.base_branch !== "main" ||
    m.target.operation_id !== "p3-trial-20261105-01" ||
    m.target.branch !== "ai-work/1/p3-trial-20261105-01" ||
    m.target.path !== "src/p3-trial-20261105-01.txt" ||
    !/^[a-f0-9]{40}$/.test(m.target.base_sha) ||
    m.app?.id !== 5621990 ||
    m.app.installation_id !== 178788421 ||
    !Array.isArray(m.manual_sources) ||
    m.manual_sources.length > 1000 ||
    new Set(m.manual_sources.map((v) => v.id)).size !== m.manual_sources.length
  )
    fail("trial_manifest_invalid");
}
function issueRow(i) {
  return {
    id: i.id,
    number: i.number,
    state: i.state,
    assignees: i.assignees.map((v) => ({ id: v.id, login: v.login })),
    labels: i.labels.map((v) => v.name),
    updated_at: i.updated_at,
    body_digest: hash(i.body ?? ""),
    contract_digest: contractDigest({ ...i, body: i.body ?? "" }),
  };
}
function sourceRows(rows, m, credential, journal, runId) {
  return rows.map((row) => {
    const expected = m.manual_sources.find((v) => v.id === row.id);
    let machine = null;
    if (!expected) {
      const prefix = "<!-- ai-workflow:github:v1 -->\n";
      if (
        typeof row.body !== "string" ||
        !row.body.startsWith(prefix) ||
        row.user?.type !== "Bot" ||
        row.user.id !== credential.actor_id
      )
        fail("trial_unknown_source");
      try {
        machine = JSON.parse(row.body.slice(prefix.length));
      } catch {
        fail("trial_unknown_source");
      }
      const receipt = journal.latest(machine?.operation_id);
      if (
        !validateGitHubArtifact("machine", machine).valid ||
        !receipt ||
        receipt.status !== "confirmed" ||
        receipt.observed.id !== row.id ||
        receipt.expected.body_digest !== hash(row.body) ||
        machine.input_digest !== receipt.input_digest ||
        machine.run_id !== runId ||
        machine.repository_id !== m.target.repository_id ||
        machine.issue_number !== m.target.issue_number
      )
        fail("trial_unknown_source");
    }
    return {
      kind: "comment",
      id: row.id,
      issue_number: m.target.issue_number,
      actor_id: row.user?.id,
      actor_type: row.user?.type,
      updated_at: row.updated_at,
      body_digest: hash(row.body ?? ""),
      state: "active",
      machine,
    };
  });
}
// One selected issue and controller lock, no worker. Readback never extends the
// original full snapshot's 60s lifetime. Every mutation re-reads authority.
export async function runActionsTrial(
  options,
  { driver, mode = "live", budgetClock } = {},
) {
  const {
    paths,
    manifest: m,
    sourceSha,
    workflowSha,
    runId,
    clock = () => new Date().toISOString(),
  } = options;
  const report = {
    version: 1,
    status: "blocked",
    mode,
    source_sha: sourceSha,
    workflow_sha: workflowSha,
    manifest_digest: hash(m),
    run_id: runId,
    repository: m.target.repository,
    repository_id: m.target.repository_id,
    issue_number: m.target.issue_number,
    app_id: m.app.id,
    installation_id: m.app.installation_id,
    request_count: 0,
    token_revocation: "not_issued",
    key_cleanup: "pending",
    receipts: [],
    journal_digest: hash([]),
    diagnostics: [],
    not_evaluated: [...NOT_EVALUATED, "live_github"],
  };
  let journal, provider, session, budget;
  try {
    assertManifest(m);
    if (
      !["live", "synthetic"].includes(mode) ||
      !/^[a-f0-9]{40}$/.test(sourceSha) ||
      !/^[a-f0-9]{40}$/.test(workflowSha)
    )
      fail("trial_host_invalid");
    try {
      lstatSync(paths.reportPath);
      fail("trial_already_recorded");
    } catch (e) {
      if (e?.code !== "ENOENT") throw e;
    }
    mkdirSync(paths.journalDirectory, { mode: 0o700 });
    journal = createFileJournal({
      directory: paths.journalDirectory,
      sourceRoot: new URL("../../", import.meta.url),
    });
    budget = createTrialBudget(budgetClock ? { clock: budgetClock } : {});
    provider = createGitHubAppTokenProvider(
      {
        enabled: true,
        appId: m.app.id,
        installationId: m.app.installation_id,
        repository: m.target.repository,
        repositoryId: m.target.repository_id,
        privateKeyPath: paths.keyPath,
        clock,
        budget,
      },
      driver,
    );
    session = await provider.issue();
    const transport = createRestTransport(
        {
          repository: m.target.repository,
          repositoryId: m.target.repository_id,
          mode: "broker",
          session,
          clock,
          budget,
        },
        driver,
      ),
      credential = await transport.identity();
    const factory = createTrialRecordFactory({
        manifest: m,
        sourceSha,
        runId,
        clock,
      }),
      base = "/repos/" + m.target.repository;
    let legacy;
    const collecting = {
      async request(request) {
        const r = await transport.request(request);
        if (
          request.path === base + "/branches/main/protection" &&
          r.status === 200
        )
          legacy = structuredClone(r.body);
        return r;
      },
    };
    let snapshot = await collectGitHubSnapshot(
      {
        policy: factory.policy,
        scope: {
          approval_sources: m.proof_sources.map((id) => ({
            kind: "comment",
            id,
            issue_number: 1,
          })),
          actors: [m.target.owner],
          include_protections: true,
        },
      },
      collecting,
      clock,
    );
    if (
      snapshot.status !== "complete" ||
      snapshot.unresolved.length ||
      Object.values(snapshot.sections).some((v) => v !== "complete")
    ) {
      report.diagnostics = snapshot.unresolved.map((code) => ({ code }));
      fail("trial_inventory_blocked");
    }
    if (
      snapshot.issues.length !== 1 ||
      snapshot.prs.length ||
      snapshot.branches.length !== 1 ||
      snapshot.branches[0].name !== "main" ||
      snapshot.branches[0].sha !== m.target.base_sha ||
      snapshot.sources.some((v) => v.machine)
    )
      fail("trial_existing_work");
    let current = factory.make(snapshot, credential, m.target.base_sha),
      prepared = false;
    const createReader = (t, signal) =>
      createClient(t, {
        repository: m.target.repository,
        limits: factory.policy.limits,
        clock,
        signal,
      });
    async function readTargets(client, branches) {
      const ir = await client.request("GET", base + "/issues/1");
      if (ir.status !== 200) fail("trial_issue_unknown");
      const sources = await client.list(
          base + "/issues/1/comments",
          factory.policy.limits.discussion_items,
        ),
        next = structuredClone(snapshot);
      next.issues = [issueRow(ir.body)];
      next.sources = sourceRows(sources, m, credential, journal, runId);
      if (branches) {
        const rows = await client.list(base + "/branches");
        next.branches = rows.map((v) => ({
          name: v.name,
          sha: v.commit?.sha,
          protected: v.protected,
        }));
        if (
          next.branches.some(
            (v) => !["main", m.target.branch].includes(v.name),
          ) ||
          next.branches.find((v) => v.name === "main")?.sha !==
            m.target.base_sha
        )
          fail("trial_branch_changed");
      }
      next.finished_at = clock();
      if (!validateGitHubArtifact("snapshot", next).valid)
        fail("trial_snapshot_invalid");
      return next;
    }
    const result = await runLimitedTrial({
      enabled: true,
      mode,
      repository: m.target.repository,
      repository_id: m.target.repository_id,
      issue_number: 1,
      operation_id: m.target.operation_id,
      branch: m.target.branch,
      path: m.target.path,
      clock,
      keys: factory.keys,
      journal,
      transport,
      async prepare({ expected_head, transport: t, signal }) {
        if (prepared) {
          snapshot = await readTargets(createReader(t, signal), true);
          if (
            snapshot.branches.find((v) => v.name === m.target.branch)?.sha !==
            expected_head
          )
            fail("trial_branch_changed");
        }
        prepared = true;
        current = factory.make(
          snapshot,
          credential,
          expected_head ?? m.target.base_sha,
        );
        return current.input;
      },
      async observe({ phase, transport: t, signal }) {
        let observed = snapshot,
          requests = 0;
        if (phase === "mutation") {
          const before = budget.requestCount,
            client = createReader(t, signal);
          observed = await readTargets(client, false);
          const permission = await client.request(
              "GET",
              base + "/collaborators/" + m.target.owner.login + "/permission",
            ),
            protection = await client.request(
              "GET",
              base + "/branches/main/protection",
            );
          if (
            permission.status !== 200 ||
            permission.body.user?.id !== m.target.owner.id ||
            permission.body.user.login !== m.target.owner.login ||
            permission.body.permission !== snapshot.permissions[0].permission ||
            protection.status !== 200 ||
            !same(protection.body, legacy)
          )
            fail("trial_authority_changed");
          observed.permissions[0].observed_at = clock();
          observed.protections[0].observed_at = clock();
          requests = budget.requestCount - before;
        }
        return {
          api_requests: requests,
          snapshot: observed,
          execution: { ...current.execution, stopped: budget.signal.aborted },
          credential,
        };
      },
    });
    report.receipts = result.receipts.filter(
      (v) => validateGitHubArtifact("receipt", v).valid,
    );
    report.diagnostics = result.diagnostics ?? [];
    report.not_evaluated = result.not_evaluated;
    report.status =
      result.status === "confirmed"
        ? "passed"
        : result.status === "unknown"
          ? "unknown"
          : "blocked";
  } catch (error) {
    report.status = report.receipts.some((v) => v.status === "unknown")
      ? "unknown"
      : "blocked";
    report.diagnostics = [
      ...report.diagnostics,
      { code: errorCode(error, "trial_host_failed") },
    ].slice(0, 1000);
  } finally {
    if (session) {
      try {
        await provider.revoke(session);
        report.token_revocation = "revoked";
      } catch {
        report.token_revocation = "unknown";
        report.status = "unknown";
        report.diagnostics.push({ code: "token_revocation_unknown" });
      }
    } else if (provider) {
      report.token_revocation = provider.revocationState?.() ?? "unknown";
      if (report.token_revocation === "unknown") report.status = "unknown";
    }
    if (journal) {
      try {
        report.journal_digest = hash(journal.records());
        journal.close();
      } catch {
        report.status = "unknown";
        report.diagnostics.push({ code: "journal_close_unknown" });
      }
    }
    try {
      removeTrialKey(paths);
      report.key_cleanup = "removed";
    } catch {
      report.key_cleanup = "unknown";
      report.status = "unknown";
      report.diagnostics.push({ code: "key_cleanup_unknown" });
    }
    report.request_count = budget?.requestCount ?? 0;
    budget?.close();
  }
  return report;
}
