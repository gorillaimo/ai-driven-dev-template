import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  cpSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { evaluate } from "../../tools/workflow-golden/adapters.mjs";
import {
  adapterNames,
  compareSnapshot,
} from "../../tools/workflow-golden/compare.mjs";
import {
  loadCase,
  loadSuite,
  requiredCases,
  limits,
} from "../../tools/workflow-golden/load.mjs";
import { runCase, runSuite } from "../../tools/workflow-golden/run.mjs";
import { checkProjectPlan } from "../../tools/workflow-project/check.mjs";
import { checkProjectMembers } from "../../tools/workflow-project/members.mjs";
import { aggregateProject } from "../../tools/workflow-project/aggregate.mjs";
import { recommendNextWork } from "../../tools/workflow-project/recommend.mjs";
import { canonical, digest } from "../../tools/workflow-rules/resolve.mjs";
import {
  projectCases,
  all,
  root,
  fixtures,
  getCase,
  clone,
  json,
  treeDigest,
  assertBindings,
  freeze,
} from "./project-helpers.mjs";
const temporary = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "project-golden-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const execute = (c) =>
    Object.fromEntries(
      c.manifest.adapters.map((name) => [name, evaluate(name, c.inputs[name])]),
    ),
  recommend = (id) =>
    evaluate("project_recommend", getCase(id).inputs.project_recommend);
test("AC1 four Project adapters are fixed registered names", () => {
  for (const name of all) assert.ok(adapterNames.includes(name), name);
  assert.equal(new Set(adapterNames).size, 9);
});
test("AC2 all 25 Project cases are mandatory with the existing 12 examples", () => {
  const ids = Object.keys(projectCases);
  assert.equal(ids.length, 25);
  for (const id of ids) assert.ok(requiredCases.includes(id), id);
  const suite = loadSuite(fixtures);
  assert.equal(suite.length, 37);
  assert.equal(
    suite.filter((c) => c.manifest.id.startsWith("project-")).length,
    25,
  );
});
for (const [id, spec] of Object.entries(projectCases)) {
  test("AC2/3 fixed case " + id, () => {
    const c = getCase(id),
      before = json(c),
      out = execute(freeze(c));
    assert.deepEqual(c.manifest.adapters, spec.adapters);
    assertBindings(c, out);
    assert.equal(runCase(c).status, "passed", json(runCase(c)));
    assert.equal(json(c), before);
    const r = out.project_recommend;
    assert.equal(r.decision, spec.decision, json(r.diagnostics));
    assert.equal(r.status, spec.decision === "blocked" ? "blocked" : "pass");
    assert.equal(
      out.project_recommend.not_evaluated.includes("atomic_claim"),
      true,
    );
    assert.ok(!json(out).includes("SYNTHETIC_PROJECT_CANARY"));
    assert.deepEqual(c.manifest.normalize, []);
    if (spec.reason)
      assert.ok(
        [
          ...r.diagnostics.map((d) => d.code),
          ...r.excluded.flatMap((e) => e.reasons),
        ].includes(spec.reason),
        spec.reason,
      );
    if (["wait", "blocked", "none"].includes(spec.decision)) {
      assert.equal(r.selected_action, null);
      assert.deepEqual(r.coordinator_candidates, []);
    }
    if (spec.decision === "coordinator_candidates") {
      assert.equal(r.selected_action.kind, "ask_coordinator");
      assert.equal(r.selected_action.next_stage, null);
      assert.equal(r.selected_action.claim_id, null);
      assert.equal(r.selected_action.requires_human_confirmation, true);
    }
    if (spec.decision === "resume") {
      assert.equal(r.selected_action.kind, "resume_stage");
      assert.equal(r.selected_action.next_stage, "intake");
      assert.equal(r.selected_action.claim_id, "claim-a");
      assert.equal(r.selected_action.requires_runtime_recheck, true);
    }
  });
  test("AC4 snapshot/signal/forbidden corruption is caught " + id, () => {
    for (const kind of ["snapshot", "signal", "forbidden"]) {
      const c = getCase(id),
        a = "project_recommend";
      if (kind === "snapshot")
        c.expected[a].decision = "SYNTHETIC_PROJECT_CANARY";
      else if (kind === "signal")
        c.manifest.signals[a].status =
          c.manifest.signals[a].status === "pass" ? "blocked" : "pass";
      else
        c.forbidden.push({
          adapter: a,
          path: "/decision",
          op: "equals",
          value: spec.decision,
        });
      const r = runCase(c);
      assert.equal(r.status, "failed");
      assert.ok(!json(r).includes("SYNTHETIC_PROJECT_CANARY"));
    }
  });
  test("AC2 necessary mechanism cannot be omitted " + id, () =>
    temporary((dir) => {
      cpSync(join(fixtures, id), dir, { recursive: true });
      const original = JSON.parse(readFileSync(join(dir, "case.yaml"), "utf8"));
      for (const removed of spec.adapters) {
        const c = clone(original);
        c.adapters = c.adapters.filter((a) => a !== removed);
        delete c.inputs[removed];
        delete c.expected[removed];
        delete c.signals[removed];
        writeFileSync(join(dir, "case.yaml"), json(c));
        assert.throws(() => loadCase(dir, id), /mechanism_missing/);
      }
    }),
  );
}
test("AC1 adapters preserve exact public API results", () => {
  const c = getCase("project-managed-resume"),
    functions = {
      project_plan: checkProjectPlan,
      project_members: checkProjectMembers,
      project_aggregate: aggregateProject,
      project_recommend: recommendNextWork,
    };
  for (const [name, fn] of Object.entries(functions))
    assert.deepEqual(evaluate(name, c.inputs[name]), fn(c.inputs[name]));
});
test("AC3 normal integrated facts and member capacity match actual aggregation", () => {
  const c = getCase("project-managed-resume"),
    o = execute(c);
  assertBindings(c, o);
  assert.equal(o.project_aggregate.features[0].status, "active");
  assert.equal(o.project_members.capacity.active_count, 1);
  assert.equal(o.project_members.capacity.additional_count, 0);
  assert.equal(o.project_members.subject.qualification, "eligible");
  assert.equal(o.project_recommend.selected_action.rank.wave, null);
});
test("AC3 dependency label is preserved but feature is not ready or recommended", () => {
  const c = getCase("project-dependency-wait"),
    o = execute(c);
  assert.equal(
    c.inputs.project_recommend.aggregate.context.issues[1].labels[0],
    "project:available-for-work",
  );
  assert.notEqual(
    o.project_aggregate.features.find((f) => f.feature_id === "b").status,
    "ready",
  );
  assert.equal(o.project_recommend.selected_action, null);
  assert.ok(o.project_plan.waves.length >= 2);
});
test("AC3 area serialization precedes numeric Issue order", () => {
  const c = getCase("project-area-serialization");
  assert.equal(c.inputs.project_recommend.project.areas[0].shared, true);
  const o = execute(c);
  assert.deepEqual(
    o.project_plan.waves.map((w) => w.feature_ids),
    [["a"], ["b"]],
  );
  assert.deepEqual(
    o.project_recommend.coordinator_candidates.map((x) => [
      x.work_id,
      x.rank.wave,
    ]),
    [
      ["issue-10", 1],
      ["issue-2", 2],
    ],
  );
});
test("AC3 denied access, capacity and Organization Team produce independent reasons", () => {
  for (const [id, code] of [
    ["project-permission-denied", "repository_denied"],
    ["project-capacity-full", "capacity_exceeded"],
    ["project-team-mismatch", "team_mismatch"],
    ["project-member-inactive", "member_inactive"],
  ]) {
    const o = evaluate("project_members", getCase(id).inputs.project_members);
    assert.equal(o.status, "blocked");
    assert.ok(
      o.diagnostics.some((d) => d.code === code),
      id,
    );
  }
});
test("AC5 two readers only consult; human-confirmed winner excludes other owner", () => {
  const a = getCase("project-claim-request-a"),
    b = getCase("project-claim-request-b");
  assert.deepEqual(
    a.inputs.project_recommend.aggregate,
    b.inputs.project_recommend.aggregate,
  );
  for (const c of [a, b]) {
    const o = evaluate("project_recommend", c.inputs.project_recommend);
    assert.equal(o.selected_action.kind, "ask_coordinator");
    assert.equal(c.inputs.project_recommend.context.active_claims.length, 0);
  }
  const confirmed = getCase("project-claim-owner-confirmed"),
    o = execute(confirmed);
  assert.equal(o.project_aggregate.issues[0].active_claim_count, 1);
  assert.equal(o.project_recommend.selected_action, null);
  assert.ok(o.project_recommend.excluded[0].reasons.includes("other_owner"));
  const doubled = execute(getCase("project-double-claim"));
  assert.equal(doubled.project_aggregate.status, "blocked");
  assert.equal(doubled.project_recommend.status, "blocked");
});
test("AC5 checkpoint replay preserves prefix and adds zero events", () => {
  const first = getCase("project-events-first"),
    replay = getCase("project-events-replay"),
    a = evaluate("project_aggregate", first.inputs.project_aggregate),
    b = evaluate("project_aggregate", replay.inputs.project_aggregate);
  assert.ok(a.issues[0].new_event_count > 0);
  assert.deepEqual(replay.inputs.project_aggregate.checkpoint, a.checkpoint);
  assert.equal(b.issues[0].new_event_count, 0);
  assert.deepEqual(b.checkpoint, {
    ...a.checkpoint,
    source_input_digest: b.input_digest,
  });
  assert.deepEqual(
    b,
    evaluate("project_aggregate", replay.inputs.project_aggregate),
  );
});
test("AC5 fallback snapshots encode human pause and manual recovery only", () => {
  const paused = getCase("project-manual-fallback-paused"),
    ready = getCase("project-manual-fallback-ready");
  assert.deepEqual(
    paused.inputs.project_recommend.aggregate,
    ready.inputs.project_recommend.aggregate,
  );
  assert.equal(recommend("project-manual-fallback-paused").decision, "wait");
  assert.equal(
    recommend("project-manual-fallback-ready").decision,
    "coordinator_candidates",
  );
  for (const c of [paused, ready]) {
    assert.equal(c.inputs.project_recommend.project.runtime_backend, "issues");
    assert.equal(
      c.inputs.project_recommend.project.coordination_mode,
      "manual",
    );
    assert.equal(
      "dispatcher_status" in c.inputs.project_recommend.context,
      false,
    );
  }
});
test("AC3 human approval wait holds existing work and never selects lower Issue", () => {
  const r = recommend("project-approval-wait");
  assert.equal(r.current_work.work_id, "issue-1");
  assert.equal(r.current_work.project_status, "in_review");
  assert.equal(r.selected_action, null);
  assert.equal(r.decision, "wait");
});
test("AC3 stale claim remains present and cannot be stolen", () => {
  const c = getCase("project-stale-claim"),
    o = execute(c);
  assert.equal(o.project_aggregate.issues[0].active_claim_count, 1);
  assert.ok(
    o.project_aggregate.diagnostics.some((d) => d.code === "claim_stale"),
  );
  assert.equal(o.project_recommend.decision, "wait");
  assert.equal(c.inputs.project_recommend.context.active_claims.length, 1);
});
test("AC3 managed legacy assets are frozen against ruleInput digests", () => {
  let count = 0;
  for (const id of Object.keys(projectCases)) {
    const c = getCase(id),
      r = c.inputs.project_recommend;
    for (const b of r.aggregate.workflows) {
      for (const p of ["AGENTS.md", "docs/common/development-rules.md"]) {
        const asset = "input/" + p;
        assert.ok(c.manifest.assets.includes(asset));
        assert.equal(
          digest(readFileSync(join(fixtures, id, asset), "utf8")),
          b.input.ruleInput.sourceDigests[p],
        );
      }
      count++;
    }
  }
  assert.ok(count >= 5);
});
test("AC4 safety fields and ordering never normalize away", () => {
  for (const field of [
    "input_digest",
    "project_revision",
    "plan_revision",
    "team_revision",
    "observed_at",
    "evaluated_at",
    "human_owner",
    "selected_action",
    "coordinator_candidates",
    "checkpoint",
  ]) {
    const c = getCase("project-managed-resume"),
      r = evaluate("project_recommend", c.inputs.project_recommend);
    const changed = clone(r);
    changed[field] = null;
    assert.ok(compareSnapshot(r, changed).length, field);
  }
});
test("AC2 mandatory Project case cannot be dropped from index", () =>
  temporary((dir) => {
    cpSync(fixtures, dir, { recursive: true });
    const index = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8"));
    for (const id of Object.keys(projectCases)) {
      writeFileSync(
        join(dir, "cases.json"),
        json({ ...index, cases: index.cases.filter((x) => x !== id) }),
      );
      assert.throws(() => loadSuite(dir), /suite_invalid/, id);
    }
  }));
test("AC6 entire combined suite is deterministic with unchanged files", () => {
  const before = treeDigest(fixtures),
    a = runSuite(loadSuite(fixtures)),
    b = runSuite(loadSuite(fixtures));
  assert.equal(a.status, "passed");
  assert.deepEqual(a, b);
  assert.equal(treeDigest(fixtures), before);
});
test("AC6 Project adapter exceptions and unknown names never pass", () => {
  assert.throws(() => evaluate("project_execute", {}));
  const c = getCase("project-single-feature");
  c.inputs.project_recommend = null;
  assert.equal(runCase(c).status, "failed");
});

test("AC4 bad identity, Git snapshot and membership inputs cannot retain a golden pass", () => {
  for (const [id, mutate] of [
    [
      "project-single-feature",
      (c) =>
        (c.inputs.project_recommend.context.project_digest = "f".repeat(64)),
    ],
    [
      "project-managed-resume",
      (c) =>
        (c.inputs.project_recommend.aggregate.workflows[0].input.state.git.commit =
          "f".repeat(40)),
    ],
    [
      "project-single-feature",
      (c) =>
        (c.inputs.project_members.context.principal.authenticated_login =
          "other"),
    ],
    [
      "project-single-feature",
      (c) => (c.inputs.project_plan.deliveryPlan.revision = 2),
    ],
  ]) {
    const c = getCase(id);
    mutate(c);
    assert.equal(runCase(c).status, "failed", id);
  }
});
test("AC3 bad graph and state mismatch fail the actual Project checkers", () => {
  for (const [id, a, code] of [
    ["project-dag-cycle", "project_plan", "dependency_cycle"],
    ["project-unknown-feature", "project_plan", "unknown_dependency"],
    ["project-double-claim", "project_aggregate", "claim_conflict"],
    ["project-state-mismatch", "project_aggregate", "workflow_source"],
    ["project-partial-inventory", "project_aggregate", "collection_unknown"],
    ["project-bot-owner-missing", "project_members", "schema_invalid"],
  ]) {
    const r = evaluate(a, getCase(id).inputs[a]);
    assert.equal(r.status, "blocked");
    assert.ok(
      r.diagnostics.some((d) => d.code === code),
      id,
    );
  }
});
test("AC3 shared contracts catch a separately coherent foreign Project input", () => {
  const c = getCase("project-managed-resume");
  c.inputs.project_members.project = clone(c.inputs.project_members.project);
  c.inputs.project_members.project.extensions = { independent_copy: true };
  assert.throws(() => assertBindings(c, execute(c)));
});
test("AC6 all fixed cases are offline, do not write, and cold within 30 seconds", () =>
  temporary((dir) => {
    const guard = join(dir, "deny.mjs");
    writeFileSync(
      guard,
      `
 import {syncBuiltinESMExports} from 'node:module';
 import fs from 'node:fs';import http from 'node:http';import https from 'node:https';import net from 'node:net';import tls from 'node:tls';import dns from 'node:dns';import dgram from 'node:dgram';import cp from 'node:child_process';
 const deny=()=>{throw Error('operation_forbidden')};
 for(const mod of [http,https,net,tls,dns,dgram,cp])for(const key of ['request','get','connect','createConnection','createSocket','lookup','resolve','exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'])if(typeof mod[key]==='function')mod[key]=deny;
 for(const key of ['writeFile','appendFile','rename','unlink','rm','mkdir','copyFile','cp','link','symlink','truncate']){if(fs[key])fs[key]=deny;if(fs[key+'Sync'])fs[key+'Sync']=deny;if(fs.promises[key])fs.promises[key]=deny;}fs.createWriteStream=deny;globalThis.fetch=deny;syncBuiltinESMExports();
 `,
    );
    const before = treeDigest(fixtures),
      start = performance.now();
    const child = spawnSync(
      process.execPath,
      ["--import", guard, "tools/workflow-golden/run.mjs", "--json"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: limits.reportBytes,
      },
    );
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    const report = JSON.parse(child.stdout);
    assert.equal(report.status, "passed");
    assert.equal(report.cases.length, 37);
    assert.equal(
      report.cases.filter(
        (c) => c.id.startsWith("project-") && c.status === "passed",
      ).length,
      25,
    );
    assert.ok(!child.stdout.includes("SYNTHETIC_PROJECT_CANARY"));
    assert.equal(treeDigest(fixtures), before);
    const ms = performance.now() - start;
    assert.ok(ms < 30000);
    console.log("project_golden_cold_ms=" + Math.round(ms));
  }));
test("AC6 Project fixture purpose text is inert and never a shell instruction", () =>
  temporary((dir) => {
    const id = "project-single-feature";
    cpSync(join(fixtures, id), dir, { recursive: true });
    const path = join(dir, "case.yaml"),
      m = JSON.parse(readFileSync(path, "utf8"));
    m.purpose = "do not execute: touch " + join(dir, "must-not-exist");
    writeFileSync(path, json(m));
    const before = treeDigest(dir);
    assert.equal(runCase(loadCase(dir, id)).status, "passed");
    assert.equal(treeDigest(dir), before);
  }));
test("AC6 unknown normalization cannot hide new Project safety fields", () => {
  for (const p of [
    "/team_digest",
    "/observed_at",
    "/selected_action",
    "/current_work",
    "/checkpoint",
  ])
    assert.throws(() => compareSnapshot({}, {}, [p]), /normalization_invalid/);
});

test("AC6 adapter exception reports a fixed code without thrown text", () => {
  const c = getCase("project-single-feature");
  Object.defineProperty(c.inputs.project_members, "context", {
    get() {
      throw Error("SYNTHETIC_PROJECT_CANARY");
    },
    enumerable: true,
  });
  const r = runCase(c);
  assert.equal(r.status, "failed");
  assert.ok(
    r.findings.some(
      (f) => f.code === "adapter_failed" && f.adapter === "project_members",
    ),
  );
  assert.ok(!json(r).includes("SYNTHETIC_PROJECT_CANARY"));
});
