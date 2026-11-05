import { valid } from "./schema.mjs";
import {
  safe,
  hash,
  same,
  configurationDigest,
  pathValid,
  fail,
  code,
} from "./core.mjs";
export function validateProjectV2(input) {
  const result = {
    status: "blocked",
    configuration_digest: null,
    diagnostics: [],
    waves: {},
  };
  try {
    if (!safe(input)) fail("input_invalid");
    const { project: p, team: t, deliveryPlan: d } = input;
    for (const [name, v] of [
      ["project", p],
      ["team", t],
      ["delivery-plan", d],
    ])
      if (!valid("urn:ai-workflow:project:v2:" + name, v))
        fail("project_v2_invalid");
    if (
      p.project_id !== t.project_id ||
      p.project_id !== d.project_id ||
      !same(p.membership_source, t.membership_source)
    )
      fail("project_binding_mismatch");
    if (p.membership_source.organization_team)
      fail("membership_adapter_unsupported");
    if (
      !["write", "maintain", "admin"].includes(p.required_repository_permission)
    )
      fail("project_permission_invalid");
    if (
      p.areas.length > 200 ||
      t.members.length > 1000 ||
      d.features.length > 1000 ||
      d.features.reduce((n, f) => n + f.issue_refs.length, 0) > 100 ||
      d.features.reduce((n, f) => n + f.depends_on.length, 0) > 10000 ||
      p.areas.reduce((n, a) => n + a.paths.length, 0) > 10000
    )
      fail("project_limit");
    for (const [field, v] of [
      ["team", t],
      ["delivery_plan", d],
    ])
      if (
        p.dispatcher[field].revision !== v.revision ||
        p.dispatcher[field].digest !== hash(v)
      )
        fail("configuration_digest_mismatch");
    const unique = (rows) => new Set(rows).size === rows.length;
    if (
      !unique(p.areas.map((a) => a.area_id)) ||
      !unique(t.members.map((m) => m.github_login.toLowerCase())) ||
      !unique(d.features.map((f) => f.feature_id))
    )
      fail("duplicate_identifier");
    const areas = new Set(p.areas.map((a) => a.area_id)),
      members = new Map(t.members.map((m) => [m.github_login, m]));
    for (const a of p.areas) {
      if (a.paths.some((x) => !pathValid(x))) fail("path_invalid");
      if (
        a.shared &&
        (!members.get(a.integration_owner)?.active ||
          !members
            .get(a.integration_owner)
            .integration_owner.includes(a.area_id))
      )
        fail("integration_owner_invalid");
    }
    for (const m of t.members)
      if ([...m.areas, ...m.integration_owner].some((a) => !areas.has(a)))
        fail("unknown_area");
    for (const c of p.coordinators.assignments)
      if (
        !members.get(c.github_login)?.active ||
        !members.get(c.github_login).roles.includes("coordinator") ||
        c.area_ids.some((a) => !areas.has(a))
      )
        fail("coordinator_invalid");
    const features = new Map(d.features.map((f) => [f.feature_id, f]));
    const seenIssues = new Set(),
      visiting = new Set(),
      waves = {};
    const wave = (id) => {
      if (visiting.has(id)) fail("dependency_cycle");
      if (Object.hasOwn(waves, id)) return waves[id];
      const f = features.get(id);
      if (!f) fail("dependency_unknown");
      visiting.add(id);
      let w = 0;
      for (const dep of f.depends_on) w = Math.max(w, wave(dep.feature_id) + 1);
      visiting.delete(id);
      return (waves[id] = w);
    };
    for (const f of d.features) {
      wave(f.feature_id);
      if (f.constraints.some((c) => c.area_id && !areas.has(c.area_id)))
        fail("unknown_area");
      if (
        new Set(f.depends_on.map((d) => d.feature_id)).size !==
        f.depends_on.length
      )
        fail("duplicate_dependency");
      if (f.area_ids.some((id) => !areas.has(id))) fail("unknown_area");
      for (const r of f.issue_refs) {
        const prefix = "https://github.com/" + p.repository + "/issues/";
        if (
          !r.issue_ref.startsWith(prefix) ||
          !/^\d+$/.test(r.issue_ref.slice(prefix.length))
        )
          fail("issue_reference_invalid");
        const n = Number(r.issue_ref.slice(prefix.length));
        if (
          !Number.isSafeInteger(n) ||
          n < 1 ||
          r.work_id !== "issue-" + n ||
          seenIssues.has(n)
        )
          fail("issue_reference_invalid");
        seenIssues.add(n);
      }
    }
    Object.assign(result, {
      status: "passed",
      configuration_digest: configurationDigest(input),
      waves,
    });
  } catch (e) {
    result.diagnostics = [code(e, "project_v2_invalid")];
  }
  return result;
}
