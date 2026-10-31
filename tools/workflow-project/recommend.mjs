import { canonical, digest, compare } from "workflow-rules/resolve";
import { aggregateProject, validateAggregateArtifact } from "./aggregate.mjs";
import { checkProjectPlan } from "./check.mjs";
import {
  inspectJson,
  recommendationLimit,
  MAX_RESULT,
} from "./recommend-limits.mjs";
import { validateRecommendationArtifact } from "./recommend-schema.mjs";
import { recommendMessages } from "./recommend-messages.mjs";
import { inspectBindings, derivePlanInput } from "./recommend-bindings.mjs";
import { selectWork, ownCurrent, currentWork } from "./recommend-select.mjs";
export { validateRecommendationArtifact };
export function recommendNextWork(input) {
  const diagnostics = [],
    excluded = [];
  let cap = null,
    bytes = 0,
    count = 0,
    input_digest = null,
    c = null,
    model = null;
  const add = (
    code,
    kind = "invalid",
    work_id = null,
    source = null,
    source_code = null,
  ) => {
    if (cap) return;
    if (!recommendMessages[code]) throw Error("unknown_recommend_code");
    const d = { code, kind, work_id, source, source_code };
    bytes += Buffer.byteLength(canonical(d));
    if (++count > 999) {
      cap = "diagnostic_limit";
      return;
    }
    if (bytes > MAX_RESULT / 2) {
      cap = "output_limit";
      return;
    }
    diagnostics.push(d);
  };
  const exclude = (row, reasons) => {
    const e = {
      issue_ref: row.issue_ref,
      work_id: row.work_id,
      feature_id: row.feature_id,
      reasons: [...new Set(reasons)].sort(compare),
    };
    bytes += Buffer.byteLength(canonical(e));
    count += e.reasons.length;
    if (count > 999) {
      cap = "diagnostic_limit";
      return;
    }
    if (bytes > MAX_RESULT / 2) {
      cap = "output_limit";
      return;
    }
    excluded.push(e);
  };
  let selection = {
    status: "blocked",
    decision: "blocked",
    current_work: null,
    selected_action: null,
    coordinator_candidates: [],
  };
  const exact = (v, required, optional = []) =>
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    required.every((k) => Object.hasOwn(v, k)) &&
    Object.keys(v).every((k) => [...required, ...optional].includes(k));
  let error;
  try {
    error = inspectJson(input);
  } catch {
    error = "input_invalid";
  }
  if (error) add(error);
  else if (
    !exact(input, [
      "project",
      "deliveryPlan",
      "team",
      "aggregate",
      "planning",
      "context",
    ]) ||
    !exact(input.aggregate, ["context", "workflows"], ["checkpoint"]) ||
    !exact(input.planning, ["replan_decisions"], ["previous"])
  )
    add("input_invalid");
  else if (recommendationLimit(input)) add("input_limit");
  else {
    input_digest = digest(canonical(input));
    for (const k of ["project", "deliveryPlan", "team", "context"])
      if (!validateRecommendationArtifact(k, input[k]).valid)
        add("schema_invalid");
    if (
      !validateAggregateArtifact("context", input.aggregate.context).valid ||
      !Array.isArray(input.aggregate.workflows) ||
      !Array.isArray(input.planning.replan_decisions)
    )
      add("schema_invalid");
    if (!diagnostics.length) {
      c = input.context;
      model = inspectBindings(input, add);
      if (!diagnostics.length) {
        selection.current_work = currentWork(input, ownCurrent(input, model));
        if (c.instruction.state !== "proceed") {
          add("instruction_" + c.instruction.state, "wait");
          selection.status = "pass";
          selection.decision = "wait";
        } else {
          const aggregate = aggregateProject({
            project: input.project,
            deliveryPlan: input.deliveryPlan,
            ...input.aggregate,
          });
          if (aggregate.status !== "pass") {
            add("aggregate_blocked");
            for (const d of aggregate.diagnostics)
              add(
                "aggregate_blocked",
                d.kind === "unknown" ? "unknown" : "invalid",
                d.work_id,
                "aggregate",
                d.code,
              );
          } else if (
            aggregate.diagnostics.some((d) => d.code === "claim_stale")
          ) {
            add("claim_stale", "wait");
            selection.status = "pass";
            selection.decision = "wait";
          } else {
            const plan = checkProjectPlan(derivePlanInput(input, aggregate));
            if (plan.status !== "pass") {
              add("plan_blocked");
              for (const d of plan.diagnostics)
                add("plan_blocked", "invalid", null, "plan", d.code);
            } else
              selection = selectWork(
                input,
                model,
                aggregate,
                plan,
                add,
                exclude,
              );
          }
        }
      }
    }
  }
  const result = {
    schema_version: 1,
    recommender_version: "1.0.0",
    input_digest,
    ...Object.fromEntries(
      [
        "project_id",
        "project_revision",
        "plan_revision",
        "team_revision",
        "project_digest",
        "plan_digest",
        "team_digest",
        "observed_at",
        "evaluated_at",
        "human_owner",
        "agent_ref",
      ].map((k) => [k, c?.[k] ?? null]),
    ),
    ...selection,
    excluded: excluded.sort((a, b) => compare(a.work_id, b.work_id)),
    diagnostics: [
      ...new Map(diagnostics.map((d) => [canonical(d), d])).values(),
    ].sort((a, b) => compare(canonical(a), canonical(b))),
    not_evaluated: [
      "live_github_authenticity",
      "principal_and_permission_authenticity",
      "reference_and_approval_authenticity",
      "actual_time_and_inventory_completeness",
      "natural_language_contract_and_instruction",
      "actual_unpushed_and_scope_proof",
      "atomic_claim",
      "changes_after_snapshot",
      "actual_work_execution",
    ],
  };
  if (cap || Buffer.byteLength(canonical(result)) > MAX_RESULT)
    Object.assign(result, {
      status: "blocked",
      decision: "blocked",
      current_work: null,
      selected_action: null,
      coordinator_candidates: [],
      excluded: [],
      diagnostics: [
        {
          code: cap ?? "output_limit",
          kind: "invalid",
          work_id: null,
          source: null,
          source_code: null,
        },
      ],
    });
  if (!validateRecommendationArtifact("result", result).valid)
    throw Error("invalid_recommendation_result");
  return result;
}
