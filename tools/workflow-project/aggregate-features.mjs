import { confirmed } from "./aggregate-issues.mjs";
export function aggregateFeatures(graph, context, rows, globalUnknown, add) {
  const confirmations = new Map();
  for (const r of context.feature_confirmations) {
    if (confirmations.has(r.feature_id) || !graph.features.has(r.feature_id))
      add(
        "feature_confirmation",
        "context/feature_confirmations",
        null,
        graph.features.has(r.feature_id) ? r.feature_id : null,
      );
    confirmations.set(r.feature_id, r);
  }
  const facts = new Map();
  for (const f of context.constraint_facts) {
    const spec = graph.features.get(f.feature_id);
    const key = f.feature_id + ":" + f.constraint_index;
    if (
      !spec ||
      f.constraint_index >= spec.constraints.length ||
      facts.has(key)
    ) {
      add(
        "constraint_fact",
        "context/constraint_facts",
        null,
        spec ? f.feature_id : null,
      );
      continue;
    }
    facts.set(key, f);
  }
  const output = new Map();
  for (const id of graph.topo) {
    const f = graph.features.get(id),
      confirmation = confirmations.get(id),
      related = rows.filter((r) => r.feature_id === id),
      required = f.issue_refs.filter((r) => r.required),
      requiredRows = required.map((r) =>
        rows.find((x) => x.work_id === r.work_id),
      );
    if (!confirmation)
      add("feature_confirmation", "context/feature_confirmations", null, id);
    const deps = f.depends_on.map(
      (d) => output.get(d.feature_id)?.status ?? "unknown",
    );
    const constraints = f.constraints.map((_, n) => facts.get(id + ":" + n));
    const knownBlock =
      related.some((r) => r.reconciliation_status === "blocked") ||
      requiredRows.some(
        (r) =>
          r && ["blocked", "cancelled"].includes(r.observed_project_status),
      ) ||
      deps.some((d) => ["blocked", "cancelled"].includes(d));
    const unknown =
      globalUnknown ||
      !confirmation ||
      requiredRows.some((r) => !r || r.reconciliation_status === "unknown") ||
      related.some((r) => r.reconciliation_status === "unknown") ||
      deps.includes("unknown");
    const working = related.some(
      (r) =>
        ["assigned", "in_progress", "in_review"].includes(
          r.observed_project_status,
        ) ||
        r.active_claim_count ||
        r.prepared_claim_count,
    );
    const done =
      requiredRows.length > 0 &&
      requiredRows.every((r) => r?.observed_project_status === "completed");
    const acceptance = confirmation?.acceptance;
    let status = "planned";
    const cancel = confirmation?.cancellation;
    const validCancel =
      cancel &&
      Number.isFinite(Date.parse(cancel.approved_at)) &&
      Date.parse(cancel.approved_at) <= Date.parse(context.observed_at);
    if (
      validCancel &&
      !working &&
      !unknown &&
      !related.some((r) => r.reconciliation_status === "blocked")
    )
      status = "cancelled";
    else if (knownBlock) status = "blocked";
    else if (unknown) status = "unknown";
    else if (done && !working) {
      status = confirmed(acceptance)
        ? "completed"
        : acceptance?.state === "denied"
          ? "blocked"
          : "unknown";
      if (status === "unknown")
        add("feature_confirmation", "features", null, id, "unknown");
      if (
        deps.some((s) => s !== "completed") ||
        constraints.some((c) => c?.state !== "satisfied")
      ) {
        status = "blocked";
        add("dependency_incomplete", "features", null, id);
      }
    } else if (working) {
      status = "active";
      if (
        deps.some((s) => s !== "completed") ||
        constraints.some((c) => c?.state !== "satisfied")
      ) {
        status =
          deps.includes("unknown") ||
          constraints.some((c) => !c || c.state === "unknown")
            ? "unknown"
            : "blocked";
        add(
          "dependency_incomplete",
          "features",
          null,
          id,
          status === "unknown" ? "unknown" : "mismatch",
        );
      }
    } else if (constraints.some((c) => c?.state === "pending"))
      status = "blocked";
    else if (constraints.some((c) => !c || c.state === "unknown")) {
      status = "unknown";
      add("constraint_fact", "features", null, id, "unknown");
    } else if (
      requiredRows.length > 0 &&
      requiredRows.every((r) =>
        ["available_for_work", "completed"].includes(
          r?.observed_project_status,
        ),
      ) &&
      deps.every((s) => s === "completed")
    )
      status = "ready";
    if (cancel && !validCancel) {
      if (status !== "blocked") status = "unknown";
      add(
        "feature_confirmation",
        "context/feature_confirmations",
        null,
        id,
        "unknown",
      );
    }
    if (validCancel && working) {
      status = "blocked";
      add("terminal_claim", "features", null, id);
    }
    output.set(id, {
      feature_id: id,
      status,
      required_issue_count: required.length,
      completed_required_count: requiredRows.filter(
        (r) =>
          r?.observed_project_status === "completed" &&
          r.reconciliation_status === "consistent",
      ).length,
    });
  }
  return [...output.values()].sort((a, b) =>
    a.feature_id < b.feature_id ? -1 : a.feature_id > b.feature_id ? 1 : 0,
  );
}
