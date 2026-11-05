import { hash, same, fail } from "./core.mjs";

// Effective rules identify applicability. Never guess GitHub's fnmatch semantics.
// Unknown/hidden bypass metadata makes the whole observation unusable. The only
// inapplicable legacy field is an absent bypass property on an observed User repo.
export async function collectProtections(
  policy,
  client,
  clock,
  diagnose = () => {},
  repositoryIdentity = null,
) {
  const base = "/repos/" + policy.repository,
    reads = [];
  const read = async (path) => {
    const r = await client.request("GET", path);
    reads.push({ path, response: r });
    return r;
  };
  const listPath = base + "/rulesets?includes_parents=true";
  const rulesets = await client.list(listPath);
  const details = new Map();
  let known = true;
  const rulesetReasons = new Set();
  for (const item of rulesets) {
    if (
      !Number.isSafeInteger(item.id) ||
      !["active", "evaluate", "disabled"].includes(item.enforcement)
    )
      fail("ruleset_invalid");
    if (item.enforcement !== "active") continue;
    const r = await read(
      base + "/rulesets/" + item.id + "?includes_parents=true",
    );
    if (
      r.status !== 200 ||
      r.body.id !== item.id ||
      r.body.enforcement !== "active" ||
      !Array.isArray(r.body.rules) ||
      !Array.isArray(r.body.bypass_actors)
    ) {
      known = false;
      rulesetReasons.add("protection_ruleset_metadata_unknown");
    }
    details.set(item.id, r.body);
  }
  const result = [],
    effectiveLists = [];
  for (const branch of policy.protected_branches) {
    const legacy = await read(base + "/branches/" + branch + "/protection");
    const path = base + "/rules/branches/" + branch;
    const key = (row) =>
      typeof row?.type === "string" && Number.isSafeInteger(row.ruleset_id)
        ? row.ruleset_id + "|" + row.type
        : undefined;
    const effective = await client.list(
      path,
      policy.limits.resource_items,
      key,
    );
    effectiveLists.push({ path, effective, key });
    const active = new Set(effective.map((r) => r.ruleset_id));
    const reasons = new Set(rulesetReasons);
    let bypass = [],
      complete = known;
    for (const id of active) {
      const detail = details.get(id);
      if (
        !detail ||
        !Array.isArray(detail.bypass_actors) ||
        detail.bypass_actors.length
      ) {
        complete = false;
        reasons.add("protection_ruleset_bypass_unknown");
      }
    }
    // Conservatively require every active ruleset's bypass metadata, even if it
    // is unrelated to this branch. A read-only auditor can supply it later.
    for (const detail of details.values())
      if (!Array.isArray(detail.bypass_actors)) {
        complete = false;
        reasons.add("protection_ruleset_bypass_unknown");
      }
    let legacyEnforced = false;
    if (legacy.status === 200) {
      const b = legacy.body,
        reviews = b.required_pull_request_reviews,
        a = reviews?.bypass_pull_request_allowances,
        personal = repositoryIdentity?.owner.type === "User",
        inapplicable =
          personal &&
          reviews !== null &&
          typeof reviews === "object" &&
          !Array.isArray(reviews) &&
          !Object.hasOwn(reviews, "bypass_pull_request_allowances");
      if (!a && !inapplicable) reasons.add("protection_legacy_bypass_missing");
      else if (a) {
        if (!Array.isArray(a.users))
          reasons.add("protection_legacy_bypass_users_missing");
        if (!Array.isArray(a.apps))
          reasons.add("protection_legacy_bypass_apps_missing");
        if (!Array.isArray(a.teams))
          reasons.add("protection_legacy_bypass_teams_missing");
        else if (a.teams.length)
          reasons.add("protection_legacy_team_bypass_unknown");
      }
      if (inapplicable) {
        // GitHub permits legacy bypass lists only on organization-owned repos.
        // This is based on the collector's real repository observation, never
        // on policy owner names or omitted metadata on an organization/ruleset.
        bypass = [];
      } else if (
        !a ||
        !Array.isArray(a.users) ||
        !Array.isArray(a.apps) ||
        !Array.isArray(a.teams) ||
        a.teams.length
      )
        complete = false;
      else {
        bypass = [...a.users, ...a.apps].map((v) => v.id);
        if (personal && bypass.length) {
          complete = false;
          reasons.add("protection_legacy_personal_bypass_inconsistent");
        }
        if (bypass.some((id) => !Number.isSafeInteger(id) || id < 1)) {
          complete = false;
          reasons.add("protection_legacy_bypass_actor_invalid");
        }
      }
      legacyEnforced =
        b.enforce_admins?.enabled === true &&
        !!b.required_pull_request_reviews &&
        b.allow_force_pushes?.enabled === false &&
        b.allow_deletions?.enabled === false;
      if (b.enforce_admins?.enabled !== true)
        reasons.add("protection_legacy_admins_not_enforced");
      if (!b.required_pull_request_reviews)
        reasons.add("protection_legacy_pr_rule_missing");
      if (b.allow_force_pushes?.enabled !== false)
        reasons.add("protection_legacy_force_push_not_blocked");
      if (b.allow_deletions?.enabled !== false)
        reasons.add("protection_legacy_deletion_not_blocked");
    } else if (legacy.status !== 404) {
      complete = false;
      reasons.add(
        legacy.status === 403
          ? "protection_legacy_read_forbidden"
          : "protection_legacy_read_unavailable",
      );
    }
    const enforced =
      complete &&
      (legacyEnforced ||
        ["pull_request", "non_fast_forward", "deletion"].every((t) =>
          effective.some((r) => r.type === t && details.has(r.ruleset_id)),
        ));
    // Only fixed codes leave this module. Do not publish response bodies, actor
    // names, server messages or settings; diagnostics never grant authority.
    if (!enforced) {
      if (!reasons.size) reasons.add("protection_required_rules_missing");
      for (const code of reasons) diagnose(code);
    }
    result.push({
      branch,
      enforced: complete ? enforced : "unknown",
      bypass_actors: complete ? bypass : null,
      observed_at: clock(),
      source_digest: hash({
        repository_identity: repositoryIdentity,
        legacy: legacy.body,
        effective,
        details: [...details],
      }),
    });
  }
  // Changes during protection traversal invalidate the snapshot too.
  if (!same(rulesets, await client.list(listPath))) fail("concurrent_change");
  for (const { path, response } of reads) {
    const current = await client.request("GET", path);
    if (
      current.status !== response.status ||
      !same(current.body, response.body)
    )
      fail("concurrent_change");
  }
  for (const { path, effective, key } of effectiveLists)
    if (
      !same(
        effective,
        await client.list(path, policy.limits.resource_items, key),
      )
    )
      fail("concurrent_change");
  return result;
}
