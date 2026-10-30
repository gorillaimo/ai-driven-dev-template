import { canonical, digest, compare } from "workflow-rules/resolve";
import { inspectGraph } from "./graph.mjs";
import {
  inspectJson,
  aggregateLimit,
  MAX_RESULT,
} from "./aggregate-limits.mjs";
import { validateAggregateArtifact } from "./aggregate-schema.mjs";
import { aggregateMessages } from "./aggregate-messages.mjs";
import { prepareCheckpoint } from "./aggregate-checkpoint.mjs";
import { inspectIssue } from "./aggregate-issues.mjs";
import { aggregateFeatures } from "./aggregate-features.mjs";
export { validateAggregateArtifact };
const statusKeys = [
    "draft",
    "available_for_work",
    "assigned",
    "in_progress",
    "in_review",
    "blocked",
    "completed",
    "cancelled",
    "unknown",
  ],
  featureKeys = [
    "planned",
    "ready",
    "active",
    "blocked",
    "completed",
    "cancelled",
    "unknown",
  ];
const emptyCounts = () => ({
  issue_count: 0,
  feature_count: 0,
  issue_statuses: Object.fromEntries(statusKeys.map((s) => [s, 0])),
  feature_statuses: Object.fromEntries(featureKeys.map((s) => [s, 0])),
});
const fold = (s) => s.toLowerCase();
export function aggregateProject(input) {
  const diagnostics = [],
    checks = [],
    notEvaluated = new Set([
      "live_github_authenticity",
      "actual_time_and_inventory_completeness",
      "reference_and_approval_authenticity",
      "membership_permission_capacity",
      "actual_scope_conflicts",
      "atomic_claim",
      "plan_revision_audit",
      "actual_work_execution",
      "checkpoint_authenticity",
      "natural_language_acceptance",
    ]);
  let cap = null,
    diagnosticBytes = 0,
    safe = false,
    schema = false,
    inputDigest = null;
  const add = (
    code,
    path = "input",
    work_id = null,
    feature_id = null,
    kind = "mismatch",
  ) => {
    if (cap) return;
    if (!aggregateMessages[code]) throw Error("unknown_aggregate_code");
    if (diagnostics.length >= 999) {
      cap = "diagnostic_limit";
      return;
    }
    const d = {
      code,
      kind,
      path: path || "input",
      work_id,
      feature_id,
      recovery:
        kind === "warning"
          ? "claim_update"
          : kind === "unknown"
            ? "confirm_facts"
            : kind === "invalid"
              ? "review_input"
              : "reconcile",
    };
    diagnosticBytes += Buffer.byteLength(canonical(d));
    if (diagnosticBytes > MAX_RESULT / 2) {
      cap = "output_limit";
      return;
    }
    diagnostics.push(d);
  };
  const check = (check_id, action) => {
    const n = diagnostics.filter((d) => d.kind !== "warning").length;
    action();
    checks.push({
      check_id,
      status:
        n === diagnostics.filter((d) => d.kind !== "warning").length && !cap
          ? "pass"
          : "block",
    });
  };
  let issues = [],
    features = [],
    checkpoint = null,
    counts = emptyCounts();
  check("input", () => {
    let error;
    try {
      error = inspectJson(input);
    } catch {
      error = "input_invalid";
    }
    if (error) {
      add(error, "input", null, null, "invalid");
      return;
    }
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (k) =>
          ![
            "project",
            "deliveryPlan",
            "context",
            "workflows",
            "checkpoint",
          ].includes(k),
      )
    ) {
      add("input_invalid", "input", null, null, "invalid");
      return;
    }
    if (aggregateLimit(input)) {
      add("input_limit", "input", null, null, "invalid");
      return;
    }
    inputDigest = digest(canonical(input));
    safe = true;
  });
  if (safe)
    check("schema", () => {
      for (const k of [
        "project",
        "deliveryPlan",
        "context",
        ...(input.checkpoint !== undefined ? ["checkpoint"] : []),
      ])
        if (!validateAggregateArtifact(k, input[k]).valid)
          add("schema_invalid", k, null, null, "invalid");
      if (
        !Array.isArray(input.workflows) ||
        input.workflows.some(
          (w) =>
            !w ||
            typeof w !== "object" ||
            Array.isArray(w) ||
            Object.keys(w).some((k) => !["issue_ref", "input"].includes(k)) ||
            typeof w.issue_ref !== "string" ||
            !w.input ||
            typeof w.input !== "object" ||
            Array.isArray(w.input) ||
            Object.keys(w.input).some(
              (k) =>
                ![
                  "plan",
                  "state",
                  "context",
                  "ruleInput",
                  "previous",
                  "revisionPlans",
                ].includes(k),
            ) ||
            (w.input.previous &&
              Object.keys(w.input.previous).some(
                (k) => !["plan", "state"].includes(k),
              )),
        )
      )
        add("schema_invalid", "workflows", null, null, "invalid");
      schema = !diagnostics.length;
    });
  if (schema) {
    const { project: p, deliveryPlan: plan, context: c } = input;
    let globalUnknown = false,
      graph,
      validGraph = true;
    check("binding", () => {
      if (
        p.project_id !== plan.project_id ||
        c.project_id !== p.project_id ||
        fold(c.repository) !== fold(p.repository) ||
        c.project_revision !== p.revision ||
        c.plan_revision !== plan.revision ||
        c.project_digest !== digest(canonical(p)) ||
        c.plan_digest !== digest(canonical(plan))
      ) {
        add("context_mismatch");
        globalUnknown = true;
      }
      const obs = Date.parse(c.observed_at),
        ev = Date.parse(c.evaluated_at);
      if (
        !Number.isFinite(obs) ||
        !Number.isFinite(ev) ||
        obs > ev ||
        ev - obs > c.freshness_limit_seconds * 1000 ||
        [p.updated_at, plan.updated_at].some(
          (t) => !Number.isFinite(Date.parse(t)) || Date.parse(t) > obs,
        )
      ) {
        add("snapshot_stale", "context", null, null, "unknown");
        globalUnknown = true;
      }
      if (c.collection_status !== "complete") {
        add("collection_unknown", "context", null, null, "unknown");
        globalUnknown = true;
      }
      if (new Set(Object.values(p.status_mapping)).size !== 8) {
        add("status_mapping", "project");
        globalUnknown = true;
      }
      if (
        p.claim_policy.heartbeat_interval_seconds >=
        p.claim_policy.stale_after_seconds
      ) {
        add("claim_time", "project");
        globalUnknown = true;
      }
    });
    check("dag", () => {
      graph = inspectGraph(p, plan, (code, path, f) => {
        validGraph = false;
        add(code, path, null, f);
      });
    });
    if (validGraph) {
      const expected = new Map(),
        source = new Map(),
        bundles = new Map(),
        claimIds = new Map();
      for (const f of plan.features)
        for (const r of f.issue_refs)
          expected.set(r.work_id, { ...r, feature_id: f.feature_id });
      check("inventory", () => {
        for (const row of c.issues) {
          if (source.has(row.work_id)) {
            add(
              "duplicate_issue",
              "context/issues",
              row.work_id,
              expected.get(row.work_id)?.feature_id ?? null,
            );
            globalUnknown = true;
          }
          source.set(row.work_id, row);
          const e = expected.get(row.work_id),
            m =
              /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/([1-9][0-9]*)$/.exec(
                row.issue_ref,
              );
          if (!e) {
            const known = [...expected.values()].find(
              (x) => fold(x.issue_ref) === fold(row.issue_ref),
            );
            if (known)
              add(
                "issue_identity",
                "context/issues",
                known.work_id,
                known.feature_id,
              );
            else add("issue_unknown");
            globalUnknown = true;
          } else if (
            !m ||
            fold(m[1]) !== fold(p.repository) ||
            row.work_id !== "issue-" + m[2] ||
            fold(row.issue_ref) !== fold(e.issue_ref) ||
            row.feature_id !== e.feature_id
          ) {
            add("issue_identity", "context/issues", e.work_id, e.feature_id);
            globalUnknown = true;
          }
        }
        for (const row of c.issues)
          for (const claim of row.claims) {
            if (
              claimIds.has(claim.claim_id) &&
              claimIds.get(claim.claim_id) !== row.work_id
            ) {
              add(
                "claim_conflict",
                "context/issues/claims",
                expected.has(row.work_id) ? row.work_id : null,
                expected.get(row.work_id)?.feature_id ?? null,
              );
              globalUnknown = true;
            }
            claimIds.set(claim.claim_id, row.work_id);
          }
        for (const e of expected.values())
          if (!source.has(e.work_id))
            add(
              "issue_missing",
              "context/issues",
              e.work_id,
              e.feature_id,
              "unknown",
            );
        for (const b of input.workflows) {
          const m = /\/issues\/([1-9][0-9]*)$/.exec(b.issue_ref),
            work = m ? "issue-" + m[1] : "";
          if (
            !expected.has(work) ||
            fold(expected.get(work).issue_ref) !== fold(b.issue_ref)
          ) {
            add("workflow_unknown");
            globalUnknown = true;
          } else {
            if (!bundles.has(work)) bundles.set(work, []);
            bundles.get(work).push(b);
          }
        }
      });
      const cp = prepareCheckpoint(c, input.checkpoint, inputDigest, add);
      if (!cp.valid) globalUnknown = true;
      for (const [work, r] of cp.prior)
        if (!expected.has(work) || !source.has(work)) {
          add(
            "checkpoint_mismatch",
            "checkpoint",
            expected.has(work) ? work : null,
            expected.get(work)?.feature_id ?? null,
            "unknown",
          );
          globalUnknown = true;
        }
      check("issues", () => {
        for (const e of expected.values()) {
          const row = source.get(e.work_id);
          if (!row) continue;
          issues.push(
            inspectIssue(
              row,
              graph.features.get(e.feature_id),
              p,
              c,
              bundles,
              cp,
              globalUnknown,
              add,
              notEvaluated,
            ),
          );
        }
      });
      // Global inventory/identity failures cannot be concealed by locally valid rows.
      check("features", () => {
        features = aggregateFeatures(graph, c, issues, globalUnknown, add);
      });
      // Feature-level validation failures must not leave a ready/completed display.
      const invalidFeatures = new Set(
        diagnostics
          .filter((d) => d.kind !== "warning" && d.feature_id)
          .map((d) => d.feature_id),
      );
      for (const id of graph.topo)
        if (
          graph.features
            .get(id)
            .depends_on.some((d) => invalidFeatures.has(d.feature_id))
        )
          invalidFeatures.add(id);
      for (const f of features)
        if (
          invalidFeatures.has(f.feature_id) &&
          ["ready", "completed"].includes(f.status)
        )
          f.status = diagnostics.some(
            (d) =>
              d.feature_id === f.feature_id &&
              d.kind !== "unknown" &&
              d.kind !== "warning",
          )
            ? "blocked"
            : "unknown";
      issues.sort((a, b) => compare(a.work_id, b.work_id));
      checkpoint = cp.finish();
      counts.issue_count = expected.size;
      counts.feature_count = graph.features.size;
      for (const e of expected.values()) {
        const row = issues.find((r) => r.work_id === e.work_id);
        counts.issue_statuses[row?.observed_project_status ?? "unknown"]++;
      }
      for (const f of features) counts.feature_statuses[f.status]++;
    }
  }
  if (cap)
    diagnostics.push({
      code: cap,
      kind: "invalid",
      path: "output",
      work_id: null,
      feature_id: null,
      recovery: "review_input",
    });
  const c = schema ? input.context : null;
  const result = {
    schema_version: 1,
    aggregator_version: "1.0.0",
    input_digest: inputDigest,
    project_id: c?.project_id ?? null,
    project_revision: c?.project_revision ?? null,
    plan_revision: c?.plan_revision ?? null,
    project_digest: c?.project_digest ?? null,
    plan_digest: c?.plan_digest ?? null,
    observed_at: c?.observed_at ?? null,
    evaluated_at: c?.evaluated_at ?? null,
    status: diagnostics.some((d) => d.kind !== "warning") ? "blocked" : "pass",
    checks,
    issues,
    features,
    counts,
    checkpoint,
    diagnostics: [
      ...new Map(diagnostics.map((d) => [canonical(d), d])).values(),
    ].sort((a, b) => compare(canonical(a), canonical(b))),
    not_evaluated: [...notEvaluated].sort(compare),
  };
  if (cap || Buffer.byteLength(canonical(result)) > MAX_RESULT) {
    Object.assign(result, {
      status: "blocked",
      issues: [],
      features: [],
      counts: emptyCounts(),
      checkpoint: null,
      diagnostics: [
        {
          code: cap ?? "output_limit",
          kind: "invalid",
          path: "output",
          work_id: null,
          feature_id: null,
          recovery: "review_input",
        },
      ],
    });
  }
  if (!validateAggregateArtifact("result", result).valid)
    throw Error("invalid_aggregate_result");
  return result;
}
