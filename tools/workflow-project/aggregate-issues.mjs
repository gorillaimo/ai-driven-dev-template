import { checkWorkflow } from "../workflow-check/check.mjs";
import { inspectEvents } from "./aggregate-checkpoint.mjs";
const fold = (s) => s?.toLowerCase(),
  time = (s) => Date.parse(s);
export const confirmed = (f) => f?.state === "confirmed" && !!f.evidence;
export function inspectIssue(
  row,
  feature,
  project,
  context,
  bundles,
  cp,
  globalUnknown,
  emit,
  notEvaluated,
) {
  let mismatch = false,
    unknown = globalUnknown;
  const add = (code, path = "issues", kind = "mismatch") => {
    if (kind === "unknown") unknown = true;
    else if (kind !== "warning") mismatch = true;
    emit(code, path, row.work_id, row.feature_id, kind);
  };
  const states = Object.keys(project.status_mapping).filter((k) =>
    row.labels.includes(project.status_mapping[k]),
  );
  const observed = states.length === 1 ? states[0] : null;
  if (!observed) add("status_mapping");
  if (row.inventory_status !== "complete")
    add("inventory_unknown", "issues/inventory_status", "unknown");
  if (row.github_state === "unknown")
    add("source_unknown", "issues/github_state", "unknown");
  const fresh = time(row.observed_at),
    evalAt = time(context.evaluated_at),
    obs = time(context.observed_at);
  if (
    !Number.isFinite(fresh) ||
    fresh > obs ||
    evalAt - fresh > context.freshness_limit_seconds * 1000 ||
    !Number.isFinite(time(row.issue_updated_at)) ||
    time(row.issue_updated_at) > fresh
  )
    add("snapshot_stale", "issues/observed_at", "unknown");
  if (new Set(row.assignees.map(fold)).size !== row.assignees.length)
    add("owner_mismatch");
  if (
    row.human_owner &&
    !row.assignees.some((a) => fold(a) === fold(row.human_owner))
  )
    add("owner_mismatch");
  if (["assigned", "in_progress"].includes(observed) && !row.human_owner)
    add("owner_mismatch");
  if (row.pending_operations.length) add("pending_operation");
  if (row.unpushed.state === "unknown" || !row.unpushed.evidence)
    add("unpushed_unknown", "issues/unpushed", "unknown");
  if (
    ["available_for_work", "assigned", "in_progress"].includes(observed) &&
    (!confirmed(row.preconditions) || row.ready_for_ai !== true)
  )
    add(
      "precondition",
      "issues/preconditions",
      row.preconditions.state === "denied" || row.ready_for_ai === false
        ? "mismatch"
        : "unknown",
    );
  if (
    observed === "available_for_work" &&
    (row.human_owner || row.assignees.length)
  )
    add("status_conflict");
  if (
    row.github_state === "closed" &&
    !["completed", "cancelled"].includes(observed)
  )
    add("status_conflict");
  const coordinators = project.coordinators.assignments
    .filter(
      (a) =>
        project.coordinators.scope === "project" ||
        a.area_ids.some((id) => feature.area_ids.includes(id)),
    )
    .map((a) => fold(a.github_login));
  const validApproval = (a) =>
    a && Number.isFinite(time(a.approved_at)) && time(a.approved_at) <= fresh;
  const claims = new Set(),
    active = [],
    prepared = [];
  for (const claim of row.claims) {
    if (claims.has(claim.claim_id)) add("claim_conflict");
    claims.add(claim.claim_id);
    if (claim.phase === "prepared") {
      prepared.push(claim);
      continue;
    }
    if (claim.phase === "unknown") {
      add("inventory_unknown", "issues/claims", "unknown");
      active.push(claim);
      continue;
    }
    if (claim.phase === "released") {
      const r = claim.release;
      if (
        !r ||
        !validApproval(r.approval) ||
        r.approval.approval_type !== "claim_release" ||
        !coordinators.includes(fold(r.approval.approved_by)) ||
        !Number.isFinite(time(r.released_at)) ||
        time(r.released_at) > fresh ||
        time(r.approval.approved_at) > time(r.released_at) ||
        !claim.claimed_at ||
        time(r.released_at) < time(claim.claimed_at)
      ) {
        add("release_unconfirmed");
        active.push(claim);
      }
      continue;
    }
    active.push(claim);
    if (!row.human_owner || fold(claim.human_owner) !== fold(row.human_owner))
      add("owner_mismatch");
    const start = time(claim.claimed_at),
      heart = time(claim.last_heartbeat_at);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(heart) ||
      start > heart ||
      heart > fresh
    )
      add("claim_time");
    else if (evalAt - heart > project.claim_policy.stale_after_seconds * 1000)
      add("claim_stale", "issues/claims", "warning");
  }
  if (prepared.length) add("pending_operation");
  if (active.length > 1) add("claim_conflict");
  if (observed === "assigned" && active.length) add("status_conflict");
  if (["draft", "available_for_work"].includes(observed) && active.length)
    add("status_conflict");
  const branchNames = new Set();
  for (const b of row.branches) {
    if (branchNames.has(b.name)) add("branch_missing");
    branchNames.add(b.name);
    if (
      b.existence === "unknown" ||
      (b.existence === "confirmed" && !b.head_commit)
    )
      add("branch_missing", "issues/branches", "unknown");
    if (
      b.existence === "confirmed" &&
      !row.claims.some((c) => c.branch === b.name)
    )
      add("orphan_branch");
  }
  for (const c of active)
    if (
      !row.branches.some(
        (b) =>
          b.name === c.branch && b.existence === "confirmed" && b.head_commit,
      )
    )
      add("branch_missing");
  if (observed === "in_progress" && active.length !== 1) add("claim_conflict");
  const prs = new Set();
  for (const p of row.prs) {
    if (prs.has(p.number)) add("status_conflict");
    prs.add(p.number);
    if (p.state === "unknown") add("source_unknown", "issues/prs", "unknown");
    const b = row.branches.find((b) => b.name === p.head_branch);
    if (
      p.state === "open" &&
      (!b || b.existence !== "confirmed" || b.head_commit !== p.head_commit)
    )
      add("status_conflict");
  }
  if (observed === "in_review") {
    if (row.review.kind === "unknown" || !row.review.reference)
      add("source_unknown", "issues/review", "unknown");
    else if (!["design", "pr"].includes(row.review.kind))
      add("status_conflict");
    if (
      row.review.kind === "pr" &&
      (!active.length || !row.prs.some((p) => p.state === "open"))
    )
      add("status_conflict");
  }
  if (observed === "blocked" && !row.blockers.length) add("status_conflict");
  if (["completed", "cancelled"].includes(observed)) {
    if (active.length || prepared.length) add("terminal_claim");
    if (observed === "completed" && !confirmed(row.completion))
      add(
        "precondition",
        "issues/completion",
        row.completion.state === "denied" ? "mismatch" : "unknown",
      );
    if (observed === "cancelled" && !validApproval(row.cancellation))
      add("precondition", "issues/cancellation", "unknown");
    if (observed === "completed" && row.prs.some((p) => p.state === "open"))
      add("status_conflict");
  }
  let workflow = null,
    eventInfo = null;
  const bs = bundles.get(row.work_id) ?? [];
  if (row.workflow_mode === "legacy") {
    notEvaluated.add("legacy_workflow");
    if (bs.length || cp.prior.has(row.work_id)) add("workflow_identity");
  } else if (!bs.length) add("workflow_missing", "workflows", "unknown");
  else if (bs.length !== 1) add("workflow_duplicate", "workflows");
  else {
    const w = bs[0].input;
    const identity =
      w &&
      ["plan", "state", "context"].every(
        (k) =>
          fold(w[k]?.issue_ref) === fold(row.issue_ref) &&
          w[k]?.work_id === row.work_id &&
          w[k]?.project_id === context.project_id &&
          w[k]?.feature_id === row.feature_id,
      );
    if (!identity) add("workflow_identity", "workflows");
    try {
      const r = checkWorkflow(w),
        structural = r.checks
          .filter((c) => !["resume", "append_only"].includes(c.check_id))
          .every((c) => c.status === "pass");
      if (
        !structural ||
        r.checks.some(
          (c) => c.check_id === "append_only" && c.status === "block",
        )
      )
        add("workflow_invalid", "workflows");
      else if (identity) {
        workflow = {
          status: w.state.status,
          current_stage: w.state.current_stage,
          resume_decision: r.resume_decision,
          append_only:
            r.checks.find((c) => c.check_id === "append_only")?.status ??
            "not_evaluated",
          checks: r.checks,
        };
        if (workflow.append_only === "not_evaluated")
          notEvaluated.add("workflow_append_only");
        const snapshots = [w.plan, w.state, ...(w.revisionPlans ?? [])];
        if (w.previous) snapshots.push(w.previous.plan, w.previous.state);
        if (
          snapshots.some(
            (s) =>
              !Number.isFinite(time(s.updated_at)) ||
              time(s.updated_at) > fresh,
          )
        )
          add("workflow_source", "workflows");
        if (w.state.resume.pending_operations.length)
          add("pending_operation", "workflows");
        if (
          w.context.issue_updated_at !== row.issue_updated_at ||
          w.state.issue_updated_at !== row.issue_updated_at ||
          (row.human_owner &&
            fold(w.context.assignee) !== fold(row.human_owner))
        )
          add("workflow_source", "workflows");
        if (active.length) {
          const b = row.branches.find((b) => b.name === w.state.git.branch);
          if (
            !b ||
            b.head_commit !== w.state.git.commit ||
            w.context.git.branch !== w.state.git.branch ||
            w.context.git.commit !== w.state.git.commit ||
            w.context.git.clean !== true ||
            w.context.git.remote_matches !== true
          )
            add("workflow_source", "workflows");
        }
        const ws = w.state.status;
        if (
          (observed === "completed" && ws !== "completed") ||
          (observed === "cancelled" && ws !== "cancelled") ||
          (!["completed", "cancelled"].includes(observed) &&
            ["completed", "cancelled"].includes(ws)) ||
          (observed === "in_progress" &&
            !["planned", "in_progress"].includes(ws)) ||
          (["draft", "available_for_work", "assigned"].includes(observed) &&
            ws !== "planned") ||
          (observed === "in_review" &&
            !["planned", "in_progress", "awaiting_approval"].includes(ws))
        )
          add("status_conflict", "workflows");
        eventInfo = inspectEvents(row, w, cp, (code, path) => add(code, path));
      }
    } catch {
      add("workflow_invalid", "workflows");
    }
  }
  const reconciliation_status = mismatch
    ? "blocked"
    : unknown
      ? "unknown"
      : "consistent";
  if (cp.valid && reconciliation_status === "consistent" && eventInfo?.valid)
    cp.next.set(row.work_id, {
      issue_ref: row.issue_ref,
      work_id: row.work_id,
      events: eventInfo.events,
    });
  return {
    issue_ref: row.issue_ref,
    work_id: row.work_id,
    feature_id: row.feature_id,
    observed_project_status: observed,
    reconciliation_status,
    human_owner: row.human_owner,
    active_claim_count: active.length,
    prepared_claim_count: prepared.length,
    workflow,
    new_event_count:
      reconciliation_status === "consistent" ? (eventInfo?.newCount ?? 0) : 0,
    branch_refs: row.branches.map((b) => b.name).sort(),
    pr_numbers: row.prs.map((p) => p.number).sort((a, b) => a - b),
  };
}
