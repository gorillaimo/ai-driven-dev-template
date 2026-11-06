import { readFileSync } from "node:fs";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  badJson,
  hash,
  same,
  safePath,
  fail,
  errorCode,
} from "../workflow-github/core.mjs";
export { hash, same, fail, errorCode };
export const safe = (value) => !badJson(value);
export const reference = (kind, id, digest) => ({
  kind,
  id,
  revision: 1,
  digest,
  location: { kind: "id", target: id },
});
const ajv = new Ajv({ strict: true, allErrors: false });
addFormats(ajv);
for (const [ns, kinds] of [
  ["issue", ["common"]],
  ["execution", ["common"]],
  ["integration", ["profile", "request", "plan", "result"]],
])
  for (const kind of kinds)
    ajv.addSchema(
      JSON.parse(
        readFileSync(
          new URL(
            `../../.ai-workflow/schemas/${ns}/v1/${kind}.schema.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
export function validateIntegrationArtifact(kind, value) {
  if (!["profile", "request", "plan", "result"].includes(kind) || !safe(value))
    return { valid: false };
  return {
    valid: !!ajv.getSchema("urn:ai-workflow:integration:v1:" + kind)(value),
  };
}
export function planIntegration(input) {
  try {
    if (!safe(input) || Object.keys(input).sort().join() !== "profile,request")
      fail("input_invalid");
    const { profile: p, request: r } = input;
    if (
      !validateIntegrationArtifact("profile", p).valid ||
      !validateIntegrationArtifact("request", r).valid
    )
      fail("schema_invalid");
    if (
      r.repository !== p.repository ||
      r.repository_id !== p.repository_id ||
      r.profile_digest !== hash(p) ||
      p.repository.split("/").some((x) => x === "." || x === "..") ||
      !safePath(p.base_branch) ||
      p.scope.some((x) => !safePath(x))
    )
      fail("binding_invalid");
    if (
      !Number.isFinite(Date.parse(p.reviewed_at)) ||
      !Number.isFinite(Date.parse(p.expires_at)) ||
      Date.parse(p.reviewed_at) >= Date.parse(p.expires_at)
    )
      fail("profile_time_invalid");
    const targets = structuredClone(r.targets),
      byId = new Map(targets.map((t) => [t.issue_number, t]));
    if (
      byId.size !== targets.length ||
      new Set(targets.map((t) => t.pr_number)).size !== targets.length ||
      targets.length > p.limits.max_prs
    )
      fail("selection_invalid");
    if (
      new Set(p.checks.map((c) => c.id)).size !== p.checks.length ||
      new Set(p.required_categories).size !== p.required_categories.length ||
      p.checks.some((c) => c.timeout_seconds > p.limits.command_seconds) ||
      p.checks.some(
        (c) =>
          ["integration", "authorization", "security"].includes(c.category) &&
          c.minimum_tests < 1,
      ) ||
      p.limits.scratch_mib < 16 ||
      p.limits.memory_mib < 64 ||
      p.limits.pids < 16
    )
      fail("profile_limits_invalid");
    for (const t of targets)
      if (
        new Set(t.depends_on).size !== t.depends_on.length ||
        t.depends_on.some((d) => d === t.issue_number || !byId.has(d))
      )
        fail("dependency_invalid");
    const pending = new Set(byId.keys()),
      order = [];
    while (pending.size) {
      const ready = [...pending]
        .filter((id) => byId.get(id).depends_on.every((d) => order.includes(d)))
        .sort((a, b) => a - b);
      if (!ready.length) fail("dependency_cycle");
      order.push(ready[0]);
      pending.delete(ready[0]);
    }
    if (r.order) {
      if (
        r.order.length !== order.length ||
        new Set(r.order).size !== order.length ||
        r.order.some(
          (id, i) =>
            !byId.has(id) ||
            byId
              .get(id)
              .depends_on.some((d) => !r.order.slice(0, i).includes(d)),
        )
      )
        fail("order_invalid");
      order.splice(0, order.length, ...r.order);
    }
    const cases = [],
      seen = new Set();
    const add = (ids) => {
      const members = order.filter((id) => ids.has(id)),
        key = members.join(",");
      if (!seen.has(key)) {
        seen.add(key);
        cases.push({
          case_id: "case-" + hash(members).slice(0, 24),
          issue_numbers: members,
        });
      }
    };
    for (const id of order) {
      const closure = new Set();
      const visit = (n) => {
        if (closure.has(n)) return;
        closure.add(n);
        for (const d of byId.get(n).depends_on) visit(d);
      };
      visit(id);
      add(closure);
    }
    add(new Set(order));
    if (
      cases.length > p.limits.max_cases ||
      cases.length * p.checks.length > p.limits.max_commands
    )
      fail("case_limit");
    const value = {
      schema_version: 1,
      artifact_kind: "integration-plan",
      authority: false,
      run_id: r.run_id,
      repository: r.repository,
      repository_id: r.repository_id,
      request_digest: hash(r),
      profile_digest: r.profile_digest,
      main_sha: r.main_sha,
      bundle_digest: r.bundle_digest,
      targets: order.map((id) => byId.get(id)),
      order,
      cases,
      profile: structuredClone(p.execution_profile),
      scope: [...p.scope],
      image: p.image,
      checks_digest: hash(p.checks),
      not_evaluated: ["all_subsets_and_orders", "human_merge_approval"],
    };
    const plan = { ...value, plan_digest: hash(value) };
    if (!validateIntegrationArtifact("plan", plan).valid) fail("plan_invalid");
    return { status: "planned", authority: false, plan };
  } catch (e) {
    return {
      status: "blocked",
      authority: false,
      diagnostics: [{ code: errorCode(e, "input_invalid") }],
    };
  }
}
export function freshIntegration(previous, current) {
  return (
    validateIntegrationArtifact("plan", previous).valid &&
    validateIntegrationArtifact("plan", current).valid &&
    same(previous, current)
  );
}
export function projectIntegrationResult(result) {
  if (
    !validateIntegrationArtifact("result", result).valid ||
    !result.artifact_ref
  )
    fail("result_unprotected");
  const p = result.plan;
  return {
    schema_version: 1,
    artifact_kind: "integration-result",
    artifact_id: "integration-" + hash(result).slice(0, 32),
    revision: 1,
    repository: p.repository,
    recorded_at: result.finished_at,
    recorded_by: { actor_type: "system", actor_ref: "workflow-integration" },
    input_digest: p.plan_digest,
    evidence_refs: [result.artifact_ref],
    run_id: p.run_id,
    profile: p.profile,
    main_sha: p.main_sha,
    targets: structuredClone(p.targets),
    scope: [...p.scope],
    started_at: result.started_at,
    finished_at: result.finished_at,
    status: ["passed", "failed", "error", "not_evaluated"].includes(
      result.status,
    )
      ? result.status
      : "not_evaluated",
    log_refs: [result.artifact_ref],
  };
}
export function summarizeIntegration(result) {
  if (!validateIntegrationArtifact("result", result).valid)
    fail("result_invalid");
  const p = result.plan,
    lines = [
      "## 複数PRの統合検証",
      `実行: ${p.run_id}`,
      `結果: ${result.status} / 実行モード: ${result.mode}`,
      `main: ${p.main_sha}`,
      `Plan: ${p.plan_digest}`,
      "",
      "| Issue | PR | 対象commit |",
      "| --- | --- | --- |",
    ];
  for (const t of p.targets)
    lines.push(`| #${t.issue_number} | #${t.pr_number} | ${t.head_sha} |`);
  lines.push(
    "",
    `実施順: ${p.order.map((id) => "#" + id).join(" -> ")}`,
    "",
    "| 検証ケース | 対象Issue | Git | 検査結果 |",
    "| --- | --- | --- | --- |",
  );
  for (const c of result.cases)
    lines.push(
      `| ${c.case_id} | ${c.issue_numbers.map((id) => "#" + id).join(", ")} | ${c.git_status} | ${c.checks.map((x) => `${x.check_id}=${x.status} (tests=${x.test_count})`).join("; ") || "not_evaluated"} |`,
    );
  lines.push(
    "",
    `推奨マージ順: ${result.status === "passed" ? p.order.map((id) => "#" + id).join(" -> ") : "not_evaluated（失敗・未検証の解消が必要）"}`,
  );
  const absent = p.cases.filter(
    (c) => !result.cases.some((x) => x.case_id === c.case_id),
  );
  if (absent.length)
    lines.push(
      "未実施ケース: " +
        absent
          .map((c) => c.issue_numbers.map((id) => "#" + id).join("+"))
          .join(", "),
    );
  for (const r of result.repairs)
    lines.push(
      `修正先: ${r.issue_numbers.map((id) => "#" + id).join(", ")} / ${r.ac_refs.join(", ")} / original_issue_branch -> individual_verification -> ai_review -> integration_recheck -> human_review`,
    );
  lines.push(
    "",
    `not_evaluated: ${[...new Set([...p.not_evaluated, ...result.not_evaluated])].join(", ")}`,
  );
  if (result.diagnostics.length)
    lines.push(
      "Diagnostics: " + result.diagnostics.map((d) => d.code).join(", "),
    );
  if (result.artifact_ref)
    lines.push(
      "保護記録: " +
        result.artifact_ref.id +
        " / " +
        result.artifact_ref.digest,
    );
  lines.push(
    "推奨順は検証したcommitでの参考情報です。各マージ前に再確認し、人間がレビュー・マージを判断します。",
  );
  const text = lines.join("\n");
  if (Buffer.byteLength(text) > 32768) fail("summary_limit");
  return text;
}
