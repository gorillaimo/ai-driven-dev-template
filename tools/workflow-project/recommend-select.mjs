import { compare } from "workflow-rules/resolve";
import { stages } from "../workflow-check/plan.mjs";
import { checkWorkflow } from "../workflow-check/check.mjs";
import { fold } from "./member-ownership.mjs";
import { eligibility } from "./recommend-eligibility.mjs";
export function rankRows(i, model, plan) {
  const waves = new Map(
    (plan?.waves ?? []).flatMap((w) => w.feature_ids.map((id) => [id, w.wave])),
  );
  const rank = (row) => ({
    planned_priority: model.features.get(row.feature_id).planned_priority,
    wave: waves.get(row.feature_id) ?? null,
    issue_number: Number(row.work_id.slice(6)),
  });
  const order = (a, b) => {
    const x = rank(a),
      y = rank(b);
    return (
      x.planned_priority - y.planned_priority ||
      (x.wave ?? Infinity) - (y.wave ?? Infinity) ||
      x.issue_number - y.issue_number ||
      compare(a.feature_id, b.feature_id) ||
      compare(a.work_id, b.work_id)
    );
  };
  return { rank, order, rows: [...model.rows.values()].sort(order) };
}
export function currentWork(i, row, reasons = []) {
  if (!row) return null;
  const state = i.aggregate.workflows.find(
    (w) =>
      typeof w?.issue_ref === "string" &&
      fold(w.issue_ref) === fold(row.issue_ref),
  )?.input?.state;
  return {
    issue_ref: row.issue_ref,
    work_id: row.work_id,
    feature_id: row.feature_id,
    human_owner: row.human_owner,
    project_status:
      Object.keys(i.project.status_mapping).find((s) =>
        row.labels.includes(i.project.status_mapping[s]),
      ) ?? "unknown",
    current_stage:
      row.workflow_mode === "managed" && stages.includes(state?.current_stage)
        ? state.current_stage
        : null,
    claim_id: row.claims.find((c) => c.phase !== "released")?.claim_id ?? null,
    reasons,
  };
}
export function ownCurrent(i, model, plan) {
  const { rows } = rankRows(i, model, plan),
    login = fold(i.context.human_owner),
    own = rows.filter((r) => fold(r.human_owner ?? "") === login);
  const state = (r) => currentWork(i, r).project_status;
  return (
    own.find(
      (r) =>
        state(r) === "in_progress" &&
        r.claims.some((c) => c.phase === "active"),
    ) ??
    own.find((r) => state(r) === "assigned") ??
    own.find(
      (r) =>
        ["blocked", "in_review"].includes(state(r)) ||
        r.claims.some((c) => c.phase !== "released") ||
        r.pending_operations.length,
    ) ??
    null
  );
}
export function selectWork(i, model, aggregate, plan, add, exclude) {
  const { rank, rows } = rankRows(i, model, plan),
    c = i.context,
    login = fold(c.human_owner);
  const own = ownCurrent(i, model, plan),
    target = c.requested_issue_ref
      ? rows.find((r) => fold(r.issue_ref) === fold(c.requested_issue_ref))
      : own;
  let current_work = currentWork(i, target);
  const empty = (decision, status = "pass") => ({
    status,
    decision,
    current_work,
    selected_action: null,
    coordinator_candidates: [],
  });
  if (c.requested_issue_ref && !target) {
    add("requested_issue_unknown", "invalid");
    return empty("blocked", "blocked");
  }
  const action = (row, kind, next_stage = null) => {
    const claim = row.claims.find((c) => c.phase === "active");
    return {
      issue_ref: row.issue_ref,
      work_id: row.work_id,
      feature_id: row.feature_id,
      kind,
      human_owner: c.human_owner,
      current_stage: currentWork(i, row).current_stage,
      next_stage,
      claim_id: claim?.claim_id ?? null,
      rank: rank(row),
      reasons: [
        kind === "resume_stage"
          ? "selected_resume"
          : kind === "request_claim"
            ? "selected_claim"
            : "selected_coordinator",
      ],
      proposed_claim:
        kind === "request_claim"
          ? {
              work_id: row.work_id,
              human_owner: c.human_owner,
              agent_ref: c.agent_ref,
            }
          : null,
      branch_ref:
        claim?.branch ??
        (kind === "request_claim"
          ? "feature/" + row.work_id.slice(6) + "-" + row.feature_id
          : null),
      artifact_refs:
        row.workflow_mode === "managed"
          ? ["plan", "state"].map((name) => ({
              kind: "file",
              target:
                ".ai-workflow/issues/" + row.work_id + "/" + name + ".yaml",
            }))
          : [],
      requires_human_confirmation: kind !== "resume_stage",
      requires_runtime_recheck: true,
    };
  };
  const evaluate = (row) =>
    eligibility(
      i,
      model,
      aggregate,
      row,
      model.supplemental.get(row.work_id),
      add,
    );
  const state = (row) => currentWork(i, row).project_status;
  if (target && target.human_owner) {
    if (fold(target.human_owner) !== login) {
      exclude(target, ["other_owner"]);
      add("other_owner", "ineligible", target.work_id);
      return empty("blocked", "blocked");
    }
    const s = state(target);
    if (["completed", "cancelled"].includes(s)) {
      exclude(target, ["terminal_work"]);
      return empty("none");
    }
    if (
      !["in_progress", "assigned"].includes(s) ||
      target.pending_operations.length ||
      target.claims.some((c) => ["prepared", "unknown"].includes(c.phase))
    ) {
      current_work.reasons = ["own_wait"];
      add("own_wait", "wait", target.work_id);
      return empty("wait");
    }
    const eligible = evaluate(target);
    if (!eligible.eligible) {
      exclude(target, eligible.reasons);
      current_work.reasons = eligible.reasons;
      return empty(
        eligible.unknown ? "blocked" : "wait",
        eligible.unknown ? "blocked" : "pass",
      );
    }
    if (target.workflow_mode === "legacy") {
      add("manual_review", "wait", target.work_id);
      current_work.reasons = ["manual_review"];
      return empty("wait");
    }
    if (s === "assigned")
      return {
        ...empty("claim_request"),
        selected_action: action(target, "request_claim"),
      };
    const claim = target.claims.find((c) => c.phase === "active"),
      execution = model.supplemental.get(target.work_id).execution_confirmation;
    if (
      execution.state !== "confirmed" ||
      !execution.evidence ||
      !claim ||
      execution.claim_id !== claim.claim_id ||
      execution.agent_ref !== c.agent_ref
    ) {
      const code =
        execution.state === "denied"
          ? "execution_denied"
          : execution.state === "unknown" || !execution.evidence
            ? "execution_unknown"
            : "execution_mismatch";
      add(
        code,
        code === "execution_unknown" ? "unknown" : "ineligible",
        target.work_id,
      );
      current_work.reasons = [code];
      return empty(
        code === "execution_unknown" ? "blocked" : "wait",
        code === "execution_unknown" ? "blocked" : "pass",
      );
    }
    const bundle = i.aggregate.workflows.find(
        (w) => fold(w.issue_ref) === fold(target.issue_ref),
      ),
      workflow = checkWorkflow(bundle.input);
    if (
      workflow.status !== "pass" ||
      workflow.resume_decision !== "candidate" ||
      !workflow.next_stage
    ) {
      add("workflow_wait", "wait", target.work_id);
      for (const d of workflow.diagnostics)
        add("workflow_wait", "wait", target.work_id, "workflow", d.code);
      current_work.reasons = ["workflow_wait"];
      return empty("wait");
    }
    return {
      ...empty("resume"),
      selected_action: action(target, "resume_stage", workflow.next_stage),
    };
  }
  const eligible = [],
    pool = target ? [target] : rows;
  let unknown = false;
  for (const row of pool) {
    if (row.human_owner || row.assignees.length) {
      exclude(row, ["other_owner"]);
      continue;
    }
    if (state(row) !== "available_for_work") {
      exclude(row, ["not_available"]);
      continue;
    }
    const result = evaluate(row);
    if (result.eligible) eligible.push(action(row, "ask_coordinator"));
    else {
      exclude(row, result.reasons);
      unknown ||= result.unknown;
    }
  }
  if (unknown) return empty("blocked", "blocked");
  const candidates = eligible.slice(0, c.candidate_limit);
  return {
    ...empty(candidates.length ? "coordinator_candidates" : "none"),
    selected_action: candidates[0] ?? null,
    coordinator_candidates: candidates,
  };
}
