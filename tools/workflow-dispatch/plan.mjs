import { validateProjectV2 } from "./check.mjs";
import { valid } from "./schema.mjs";
import {
  safe,
  snapshotConsistent,
  hash,
  same,
  fresh,
  within,
  pathValid,
  overlap,
  conflicts,
  active,
  fail,
  code,
} from "./core.mjs";
export function planBatch(input) {
  const r = {
    schema_version: 1,
    artifact_kind: "batch-plan",
    status: "blocked",
    authority: false,
    configuration_digest: null,
    input_digest: null,
    selected: [],
    held: [],
    diagnostics: [],
  };
  try {
    if (
      !safe(input) ||
      !valid("urn:ai-workflow:dispatch:v1:request", {
        schema_version: 1,
        artifact_kind: "request",
        ...input,
      })
    )
      fail("input_invalid");
    const cfg = validateProjectV2(input);
    if (cfg.status !== "passed") fail(cfg.diagnostics[0]);
    r.configuration_digest = cfg.configuration_digest;
    r.input_digest = hash(input);
    const {
      project: p,
      team,
      deliveryPlan: d,
      profile,
      grant: g,
      snapshot: s,
      ledger: l,
      issue_facts: facts,
      constraint_facts: constraintFacts,
      evaluated_at: now,
    } = input;
    if (
      !snapshotConsistent(s) ||
      s.repository !== p.repository ||
      s.repository_id !== p.repository_id ||
      s.status !== "complete" ||
      s.unresolved.length ||
      Object.values(s.sections).some((v) => v !== "complete") ||
      !fresh(s.started_at, now) ||
      !fresh(s.finished_at, now) ||
      l.status !== "ready" ||
      !l.complete ||
      l.configuration_digest !== cfg.configuration_digest ||
      l.project_id !== p.project_id ||
      l.pending_operations.length
    )
      fail("inventory_unknown");
    if (
      new Set(g.selected.map((t) => t.issue_number)).size !==
        g.selected.length ||
      g.repository !== p.repository ||
      profile.repository !== p.repository ||
      g.human_owner !== profile.human_owner ||
      g.profile.digest !== hash(profile) ||
      g.profile.revision !== profile.revision ||
      g.profile.id !== profile.artifact_id ||
      g.revoked ||
      Date.parse(g.issued_at) > Date.parse(now) ||
      Date.parse(g.expires_at) <= Date.parse(now) ||
      profile.limits.cost.status !== "known"
    )
      fail("grant_invalid");
    for (const t of g.selected) {
      const issue = s.issues.find((i) => i.number === t.issue_number);
      if (
        !issue ||
        issue.contract_digest !== t.contract_digest ||
        t.work_id !== "issue-" + t.issue_number ||
        t.run_id !== g.run_id ||
        !same(t.profile, g.profile) ||
        profile.forbidden_paths.some((p) => !t.forbidden_paths.includes(p))
      )
        fail("contract_changed");
    }
    if (
      new Set(l.runs.map((x) => x.run_id)).size !== l.runs.length ||
      new Set(
        constraintFacts.map((x) => x.feature_id + ":" + x.constraint_digest),
      ).size !== constraintFacts.length
    )
      fail("inventory_conflict");
    const run = l.runs.find((x) => x.run_id === g.run_id);
    if (
      run &&
      (run.stopped ||
        Date.parse(run.expires_at) <= Date.parse(now) ||
        run.profile_digest !== hash(profile))
    )
      fail("run_stopped_or_changed");
    if (
      facts.some((f) => f.blocker === "unknown" || f.approval === "unknown") ||
      constraintFacts.some((f) => f.status === "unknown") ||
      new Set(facts.map((f) => f.issue_number)).size !== facts.length ||
      new Set(l.claims.map((c) => c.claim_id)).size !== l.claims.length ||
      new Set(l.claims.filter(active).map((c) => c.issue_number)).size !==
        l.claims.filter(active).length
    )
      fail("inventory_conflict");
    const owner = team.members.find((m) => m.github_login === g.human_owner),
      perm = s.permissions.find((v) => v.login === g.human_owner);
    if (
      !owner?.active ||
      !owner.roles.includes("developer") ||
      !perm ||
      !["write", "maintain", "admin"].includes(perm.permission) ||
      ["write", "maintain", "admin"].indexOf(perm.permission) <
        ["write", "maintain", "admin"].indexOf(
          p.required_repository_permission,
        ) ||
      !fresh(perm.observed_at, now)
    )
      fail("owner_unknown");
    if (
      input.requested_issues &&
      (new Set(input.requested_issues).size !== input.requested_issues.length ||
        input.requested_issues.some(
          (n) => !g.selected.some((t) => t.issue_number === n),
        ))
    )
      fail("requested_issue_invalid");
    const map = new Map(),
      features = new Map(d.features.map((f) => [f.feature_id, f]));
    for (const f of d.features)
      for (const ref of f.issue_refs) map.set(Number(ref.work_id.slice(6)), f);
    const completed = (id) => {
      const f = features.get(id);
      return (
        f.issue_refs.filter((x) => x.required).length > 0 &&
        f.issue_refs
          .filter((x) => x.required)
          .every((x) => {
            const n = Number(x.work_id.slice(6)),
              issue = s.issues.find((i) => i.number === n),
              fact = facts.find((f) => f.issue_number === n);
            return (
              issue?.state === "closed" &&
              fact?.pr_numbers.length > 0 &&
              fact.pr_numbers.every((pn) =>
                s.prs.some(
                  (pr) =>
                    pr.number === pn &&
                    pr.merged &&
                    pr.state === "closed" &&
                    pr.head_repository_id === s.repository_id,
                ),
              )
            );
          })
      );
    };
    const candidates = [];
    for (const [n, f] of map) {
      const issue = s.issues.find((x) => x.number === n),
        fact = facts.find((x) => x.issue_number === n);
      if (!issue || !fact) fail("issue_facts_incomplete");
      if (issue.state === "closed") continue;
      if (input.requested_issues && !input.requested_issues.includes(n))
        continue;
      const t = g.selected.find((x) => x.issue_number === n);
      if (!t) {
        r.held.push({ issue_number: n, reasons: ["grant_scope_missing"] });
        continue;
      }
      if (
        t.contract_digest !== issue.contract_digest ||
        t.work_id !== "issue-" + n ||
        t.run_id !== g.run_id ||
        !same(t.profile, g.profile)
      )
        fail("contract_changed");
      const areas = [
        ...new Set([
          ...f.area_ids,
          ...p.areas
            .filter(
              (a) =>
                (a.shared || a.conflict_policy === "serialize") &&
                overlap(t.allowed_paths, a.paths),
            )
            .map((a) => a.area_id),
        ]),
      ].sort();
      const reasons = [];
      if (
        !issue.assignees.some(
          (a) => a.login === owner.github_login && a.id === perm.actor_id,
        )
      )
        reasons.push("assignee_mismatch");
      if (!issue.labels.includes("ready-for-ai")) reasons.push("not_ready");
      if (fact.approval !== "approved" || !t.approval_refs.length)
        reasons.push("approval_missing");
      if (fact.blocker === "known") reasons.push("issue_blocked");
      if (f.depends_on.some((dep) => !completed(dep.feature_id)))
        reasons.push("dependency_incomplete");
      if (
        f.constraints.some(
          (c) =>
            !constraintFacts.some(
              (x) =>
                x.feature_id === f.feature_id &&
                x.constraint_digest === hash(c) &&
                x.status === "satisfied",
            ),
        )
      )
        reasons.push("constraint_incomplete");
      if (
        t.allowed_paths.some(
          (x) =>
            !pathValid(x) ||
            !within(x, profile.allowed_paths) ||
            within(x, [...profile.forbidden_paths, ...t.forbidden_paths]) ||
            !f.area_ids.some((id) =>
              within(x, p.areas.find((a) => a.area_id === id).paths),
            ),
        ) ||
        t.stages.some((st) => !profile.allowed_stages.includes(st)) ||
        areas.some((a) => !owner.areas.includes(a))
      )
        reasons.push("scope_invalid");
      if (l.claims.some((c) => active(c) && c.issue_number === n))
        reasons.push("already_claimed");
      candidates.push({ n, f, t, fact, reasons, areas });
    }
    candidates.sort(
      (a, b) =>
        a.fact.priority - b.fact.priority ||
        cfg.waves[a.f.feature_id] - cfg.waves[b.f.feature_id] ||
        a.n - b.n,
    );
    const live = l.claims.filter(active),
      used = live.filter((c) => c.human_owner === owner.github_login).length,
      slots = live.filter((c) => c.execution_active).length;
    const max = Math.max(
        0,
        Math.min(
          p.dispatcher.max_parallel_issues,
          profile.limits.max_concurrent_issues,
        ) - slots,
      ),
      maxIssues =
        Math.min(
          p.dispatcher.max_run_issues,
          profile.limits.max_issues,
          run?.issue_limit ?? 10,
        ) -
        (run?.issues_count ?? live.filter((c) => c.run_id === g.run_id).length);
    for (const c of candidates) {
      const t = {
        issue_number: c.n,
        feature_id: c.f.feature_id,
        human_owner: owner.github_login,
        areas: c.areas,
        allowed_paths: c.t.allowed_paths,
        forbidden_paths: c.t.forbidden_paths,
        head_sha: c.t.head_sha,
        profile_digest: hash(profile),
        grant_digest: hash(g),
        contract_digest: c.t.contract_digest,
        design_digest: c.t.design_digest,
        stages: c.t.stages,
      };
      if ([...live, ...r.selected].some((x) => conflicts(t, x, p)))
        c.reasons.push("area_or_path_reserved");
      if (used + r.selected.length >= owner.max_concurrent_issues)
        c.reasons.push("owner_capacity");
      if (r.selected.length >= max || r.selected.length >= maxIssues)
        c.reasons.push("execution_capacity");
      if (c.reasons.length)
        r.held.push({
          issue_number: c.n,
          reasons: [...new Set(c.reasons)].sort(),
        });
      else r.selected.push(structuredClone(t));
    }
    r.status = "passed";
    if (!valid("urn:ai-workflow:dispatch:v1:batch-plan", r))
      fail("output_invalid");
  } catch (e) {
    r.status = "blocked";
    r.selected = [];
    r.diagnostics = [code(e, "input_invalid")];
  }
  return r;
}
