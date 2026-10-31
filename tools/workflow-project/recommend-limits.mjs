import { aggregateLimit } from "./aggregate-limits.mjs";
import { countLimit } from "./limits.mjs";
export { inspectJson, MAX_BYTES, MAX_RESULT } from "./limits.mjs";
export function recommendationLimit(i) {
  if (
    aggregateLimit({
      project: i?.project,
      deliveryPlan: i?.deliveryPlan,
      ...i?.aggregate,
    }) ||
    (i?.planning?.previous && countLimit(i.planning.previous))
  )
    return true;
  const over = (v, n) => Array.isArray(v) && v.length > n,
    c = i?.context;
  if (
    over(i?.team?.members, 1000) ||
    over(c?.member_facts, 1000) ||
    over(c?.active_claims, 10000) ||
    over(c?.issue_facts, 100) ||
    over(i?.planning?.replan_decisions, 1000)
  )
    return true;
  for (const [rows, keys] of [
    [
      c?.issue_facts,
      ["area_ids", "file_scope", "non_scope", "owner_overrides"],
    ],
    [i?.team?.members, ["areas", "roles", "integration_owner"]],
  ])
    for (const key of keys)
      if (
        Array.isArray(rows) &&
        rows.reduce(
          (n, r) => n + (Array.isArray(r?.[key]) ? r[key].length : 0),
          0,
        ) > 10000
      )
        return true;
  return false;
}
