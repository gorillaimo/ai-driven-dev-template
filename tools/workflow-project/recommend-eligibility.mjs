import { checkProjectMembers } from "./members.mjs";
import { fold } from "./member-ownership.mjs";
import { overlap } from "./recommend-bindings.mjs";
export function eligibility(i, model, aggregate, row, fact, add) {
  const c = i.context,
    f = model.features.get(row.feature_id),
    reasons = new Set();
  let unknown = false;
  const fail = (
    code,
    kind = "ineligible",
    source = null,
    source_code = null,
  ) => {
    reasons.add(code);
    if (kind === "unknown" || kind === "invalid") unknown = true;
    add(code, kind, row.work_id, source, source_code);
  };
  const confirm = (v, base) => {
    if (v.state === "denied") fail(base + "_denied");
    else if (v.state !== "confirmed" || !v.evidence)
      fail(base + "_unknown", "unknown");
  };
  if (!row.ready_for_ai)
    fail(
      row.ready_for_ai === null ? "contract_unknown" : "unready",
      row.ready_for_ai === null ? "unknown" : "ineligible",
    );
  confirm(fact.contract.acceptance, "contract");
  confirm(fact.contract.non_scope, "contract");
  confirm(fact.approval, "approval");
  if (fact.scope_check.state === "conflict") fail("scope_conflict");
  else if (fact.scope_check.state !== "clear" || !fact.scope_check.evidence)
    fail("scope_unknown", "unknown");
  const states = new Map(
    aggregate.features.map((f) => [f.feature_id, f.status]),
  );
  const featureState = states.get(f.feature_id);
  if (["completed", "cancelled"].includes(featureState)) fail("terminal_work");
  if (featureState === "blocked") fail("unready");
  if (featureState === "unknown") fail("dependency_unknown", "unknown");
  const decision = i.planning.replan_decisions.find(
    (d) => d.feature_id === f.feature_id,
  );
  if (decision && decision.decision !== "continue")
    fail("plan_" + decision.decision);

  for (const dep of f.depends_on)
    if (states.get(dep.feature_id) !== "completed")
      fail(
        states.get(dep.feature_id) === "unknown"
          ? "dependency_unknown"
          : "dependency_pending",
        states.get(dep.feature_id) === "unknown" ? "unknown" : "ineligible",
      );
  for (let n = 0; n < f.constraints.length; n++) {
    const condition = i.aggregate.context.constraint_facts.find(
      (x) => x.feature_id === f.feature_id && x.constraint_index === n,
    );
    if (condition?.state !== "satisfied")
      fail(
        !condition || condition.state === "unknown"
          ? "constraint_unknown"
          : "constraint_pending",
        !condition || condition.state === "unknown" ? "unknown" : "ineligible",
      );
  }
  const paths = f.area_ids.flatMap(
    (id) => model.model.areas.get(id)?.paths ?? [],
  );
  for (const other of model.rows.values()) {
    const claims = other.claims.filter((c) => c.phase !== "released");
    const ownClaim =
      other.work_id === row.work_id &&
      fold(other.human_owner ?? "") === fold(c.human_owner) &&
      claims.length === 1 &&
      claims[0].phase === "active";
    const competingClaims = claims.filter(
      (claim) =>
        !(
          ownClaim &&
          claim.claim_id ===
            row.claims.find((x) => x.phase === "active")?.claim_id
        ),
    );
    const competingPrs = other.prs.filter(
      (pr) =>
        pr.state === "open" &&
        !(ownClaim && pr.head_branch === claims[0].branch),
    );
    if (!competingClaims.length && !competingPrs.length) continue;
    const otherFeature = model.features.get(other.feature_id);
    if (!otherFeature) {
      fail("scope_unknown", "unknown");
      continue;
    }
    const otherPaths = otherFeature.area_ids.flatMap(
      (id) => model.model.areas.get(id)?.paths ?? [],
    );
    if (!paths.length || !otherPaths.length) fail("scope_unknown", "unknown");
    else if (
      f.area_ids.some((id) => otherFeature.area_ids.includes(id)) ||
      paths.some((x) => otherPaths.some((y) => overlap(x, y)))
    )
      fail("scope_conflict");
  }
  const context = {
    schema_version: 1,
    ...Object.fromEntries(
      [
        "project_id",
        "repository",
        "project_revision",
        "team_revision",
        "project_digest",
        "team_digest",
        "observed_at",
        "evaluated_at",
        "freshness_limit_seconds",
        "recorded_by",
        "source",
        "principal",
        "member_facts",
        "claims_inventory_status",
        "active_claims",
      ].map((k) => [k, c[k]]),
    ),
    request: {
      mode: row.human_owner ? "assigned_owner" : "candidate",
      issue_ref: row.issue_ref,
      work_id: row.work_id,
      human_owner: c.human_owner,
      area_ids: fact.area_ids,
      assignees: row.assignees,
      responsibility_confirmation: fact.responsibility_confirmation,
      owner_overrides: fact.owner_overrides,
    },
  };
  const member = checkProjectMembers({
    project: i.project,
    team: i.team,
    context,
  });
  if (member.status !== "pass")
    for (const d of member.diagnostics)
      fail(
        d.kind === "unknown" || d.kind === "invalid"
          ? "member_unknown"
          : "member_ineligible",
        d.kind === "unknown" || d.kind === "invalid" ? "unknown" : "ineligible",
        "member",
        d.code,
      );
  return {
    eligible: reasons.size === 0,
    unknown,
    reasons: [...reasons].sort(),
  };
}
