export { inspectJson, MAX_BYTES, MAX_RESULT } from "./limits.mjs";
export function aggregateLimit(i) {
  const over = (a, n) => Array.isArray(a) && a.length > n,
    sum = (rows, key) =>
      Array.isArray(rows)
        ? rows.reduce(
            (n, r) => n + (Array.isArray(r?.[key]) ? r[key].length : 0),
            0,
          )
        : 0;
  const p = i?.project,
    d = i?.deliveryPlan,
    c = i?.context,
    w = i?.workflows,
    cp = i?.checkpoint;
  if (
    over(p?.areas, 200) ||
    over(d?.features, 1000) ||
    over(d?.revision_history, 100) ||
    over(c?.issues, 100) ||
    over(w, 100) ||
    over(cp?.issues, 100) ||
    over(c?.feature_confirmations, 1000) ||
    over(c?.constraint_facts, 10000)
  )
    return true;
  for (const key of ["depends_on", "constraints", "issue_refs", "area_ids"])
    if (sum(d?.features, key) > 10000) return true;
  if (
    sum(p?.areas, "paths") > 10000 ||
    sum(d?.features, "issue_refs") > 100 ||
    sum(d?.revision_history, "affected_feature_ids") > 10000 ||
    sum(d?.revision_history, "invalidated_waves") > 10000
  )
    return true;
  for (const k of ["claims", "branches", "prs", "pending_operations"])
    if (sum(c?.issues, k) > 1000) return true;
  let events = 0;
  if (Array.isArray(w))
    for (const b of w) {
      const x = b?.input;
      if (
        over(x?.revisionPlans, 100) ||
        over(x?.state?.history, 1000) ||
        over(x?.previous?.state?.history, 1000)
      )
        return true;
      events +=
        (x?.state?.history?.length ?? 0) +
        (x?.previous?.state?.history?.length ?? 0);
    }
  return events > 10000 || sum(cp?.issues, "events") > 10000;
}
