import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  recommendNextWork,
  validateRecommendationArtifact,
} from "../../tools/workflow-project/recommend.mjs";
import { loadProjectRecommendation } from "../../tools/workflow-project/recommend-load.mjs";
import { input, active, hundred, clone, codes, bind } from "./helpers.mjs";
const no = (i) => {
  const r = recommendNextWork(i);
  assert.equal(r.status, "blocked");
  assert.equal(r.selected_action, null);
  assert.equal(validateRecommendationArtifact("result", r).valid, true);
  return r;
};
for (const v of [
  null,
  [],
  true,
  undefined,
  () => {},
  NaN,
  Infinity,
  new Date(),
  Object.create({ x: 1 }),
  new Proxy(
    {},
    {
      ownKeys() {
        throw Error("secret-canary");
      },
    },
  ),
])
  test("AC7 unsafe JSON " + String(typeof v), () => {
    assert.equal(JSON.stringify(no(v)).includes("secret-canary"), false);
  });
test("AC7 getter never runs", () => {
  let called = false;
  const i = input();
  Object.defineProperty(i, "evil", {
    get() {
      called = true;
      throw Error("secret-canary");
    },
    enumerable: true,
  });
  no(i);
  assert.equal(called, false);
});
test("AC7 cyclic input", () => {
  const i = input();
  i.self = i;
  no(i);
});
test("AC7 symbol input rejected", () => {
  const i = input();
  i[Symbol("secret-canary")] = 1;
  assert.equal(JSON.stringify(no(i)).includes("secret-canary"), false);
});
test("AC7 sparse array rejected", () => {
  const i = input();
  i.context.issue_facts.length = 2;
  no(i);
});
test("AC7 excessive depth", () => {
  const i = input();
  let p = i;
  for (let n = 0; n < 40; n++) {
    p.extra = {};
    p = p.extra;
  }
  no(i);
});
test("AC7 byte cap across composed input", () => {
  const i = input();
  i.extra = "x".repeat(5 * 1024 * 1024);
  no(i);
});
for (const [key, lim] of [
  ["candidate_limit", 0],
  ["candidate_limit", 11],
  ["freshness_limit_seconds", 0],
  ["freshness_limit_seconds", 86401],
])
  test("AC7 explicit boundary " + key + lim, () => {
    const i = input();
    i.context[key] = lim;
    no(i);
  });
test("AC7 total issue-fact limit", () => {
  const i = input();
  i.context.issue_facts = Array(101).fill(i.context.issue_facts[0]);
  no(i);
});
test("AC7 maximum 100 Issues cold incl all validators", () => {
  const script = `const start=performance.now();const {recommendNextWork}=await import('./tools/workflow-project/recommend.mjs');const {hundred}=await import('./tests/workflow-recommend/helpers.mjs');const r=recommendNextWork(hundred());process.stdout.write(JSON.stringify({ms:performance.now()-start,status:r.status,decision:r.decision,count:r.coordinator_candidates.length}));`;
  const c = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: new URL("../../", import.meta.url),
    encoding: "utf8",
    timeout: 15000,
  });
  assert.ifError(c.error);
  assert.equal(c.status, 0, c.stderr);
  const r = JSON.parse(c.stdout);
  assert.equal(r.status, "pass");
  assert.equal(r.decision, "coordinator_candidates");
  assert.equal(r.count, 3);
  assert.ok(r.ms < 10000, JSON.stringify(r));
  console.log("recommend_cold_ms=" + Math.round(r.ms));
});
function disk() {
  const root = mkdtempSync(join(tmpdir(), "recommend-"));
  const i = input(),
    paths = {};
  const save = (key, v) => {
    writeFileSync(join(root, key + ".json"), JSON.stringify(v));
    return key + ".json";
  };
  for (const k of ["project", "deliveryPlan", "team", "context"])
    paths[k] = save(k, i[k]);
  paths.aggregate = {
    context: save("aggregate-context", i.aggregate.context),
    workflows: [],
  };
  paths.planning = { replan_decisions: save("replan", []) };
  return { root, paths, i };
}
test("AC1/7 explicit loader input nonmutation", () => {
  const { root, paths, i } = disk();
  try {
    const before = JSON.stringify(paths),
      source = readFileSync(join(root, paths.context), "utf8");
    assert.deepEqual(loadProjectRecommendation(root, paths), i);
    assert.equal(JSON.stringify(paths), before);
    assert.equal(readFileSync(join(root, paths.context), "utf8"), source);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
for (const path of [
  "../escape",
  "/etc/passwd",
  "https://github.com/example/project",
  "context.json/..",
  "a\\b",
])
  test("AC7 unsafe loader path " + path, () => {
    const { root, paths } = disk();
    try {
      paths.context = path;
      assert.throws(
        () => loadProjectRecommendation(root, paths),
        /^Error: load_(invalid|paths)$/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
for (const raw of [
  "a: 1\na: 2",
  "x: &a [1]\ny: *a",
  "---\na: 1\n---\nb: 2",
  "x: !custom value",
])
  test("AC7 strict YAML " + raw.slice(0, 12), () => {
    const { root, paths } = disk();
    try {
      writeFileSync(join(root, paths.context), raw);
      assert.throws(() => loadProjectRecommendation(root, paths));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
test("AC7 symlink never followed", () => {
  const { root, paths } = disk();
  try {
    symlinkSync(join(root, paths.context), join(root, "link"));
    paths.context = "link";
    assert.throws(() => loadProjectRecommendation(root, paths));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("AC7 directory is not data", () => {
  const { root, paths } = disk();
  try {
    mkdirSync(join(root, "dir"));
    paths.context = "dir";
    assert.throws(() => loadProjectRecommendation(root, paths));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("AC7 loader file bytes bounded", () => {
  const { root, paths } = disk();
  try {
    writeFileSync(join(root, paths.context), " ".repeat(1024 * 1024 + 1));
    assert.throws(() => loadProjectRecommendation(root, paths));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("AC7 loader unknown instructions rejected", () => {
  const { root, paths } = disk();
  try {
    paths.command = "secret-canary";
    assert.throws(
      () => loadProjectRecommendation(root, paths),
      /^Error: load_paths$/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("AC7 API has no networking, subprocess or writes", () => {
  const script = `const {input}=await import('./tests/workflow-recommend/helpers.mjs');const {recommendNextWork}=await import('./tools/workflow-project/recommend.mjs');const {syncBuiltinESMExports}=await import('node:module');const fs=(await import('node:fs')).default;const cp=(await import('node:child_process')).default;const http=(await import('node:http')).default;const https=(await import('node:https')).default;const net=(await import('node:net')).default;const bad=()=>{throw Error('side_effect')};for(const k of ['writeFileSync','appendFileSync','renameSync','unlinkSync','mkdirSync','createWriteStream'])fs[k]=bad;for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=bad;http.request=http.get=https.request=https.get=net.connect=net.createConnection=globalThis.fetch=bad;syncBuiltinESMExports();const r=recommendNextWork(input());if(r.decision!=='coordinator_candidates')throw Error('no_candidate');`;
  const c = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: new URL("../../", import.meta.url),
    encoding: "utf8",
    timeout: 15000,
  });
  assert.ifError(c.error);
  assert.equal(c.status, 0, c.stderr);
});
for (const value of [
  null,
  {},
  [null],
  [{}],
  [{ issue_ref: 1 }],
  [{ issue_ref: "x", input: {} }],
])
  test(
    "AC7 invalid composed workflow never throws " + JSON.stringify(value),
    () => {
      const i = input();
      i.aggregate.workflows = value;
      no(i);
    },
  );
test("AC7 diagnostic count/byte cap empties all recommendations", () => {
  const i = hundred();
  for (const f of i.deliveryPlan.features)
    for (let n = 0; n < 12; n++)
      f.constraints.push({
        kind: "approval",
        reference: { kind: "id", target: "gate" },
        reason: "pending",
      });
  i.aggregate.context.constraint_facts = i.deliveryPlan.features.flatMap((f) =>
    f.constraints.map((_, n) => ({
      feature_id: f.feature_id,
      constraint_index: n,
      state: "pending",
    })),
  );
  bind(i);
  const r = no(i);
  assert.ok(codes(r).includes("diagnostic_limit"));
  assert.ok(
    r.diagnostics.length +
      r.excluded.reduce((n, e) => n + e.reasons.length, 0) <=
      1000,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 1024 * 1024);
});

test("AC7 corrupt stage never escapes as current stage or raw diagnostic", () => {
  const i = active();
  i.aggregate.workflows[0].input.state.current_stage = "secret-canary";
  const r = no(i);
  assert.equal(JSON.stringify(r).includes("secret-canary"), false);
});
test("AC7 composed previous counts toward global byte cap", () => {
  const i = input();
  i.planning.previous = { extra: "x".repeat(5 * 1024 * 1024) };
  no(i);
});
test("AC7 node cap is independent of byte cap", () => {
  const i = input();
  i.extra = Array(200001).fill(null);
  no(i);
});
test("AC7 preloaded static fixture yields Coordinator only", () => {
  const root = new URL("./fixtures/", import.meta.url).pathname;
  const paths = JSON.parse(readFileSync(join(root, "paths.json"), "utf8"));
  const i = loadProjectRecommendation(root, paths),
    r = recommendNextWork(i);
  assert.equal(r.decision, "coordinator_candidates");
  assert.equal(r.selected_action.kind, "ask_coordinator");
});
test("AC7 loader carries explicit previous/checkpoint without following references", () => {
  const { root, paths, i } = disk();
  try {
    paths.planning.previous = {
      project: paths.project,
      deliveryPlan: paths.deliveryPlan,
      context: "old-context.json",
    };
    writeFileSync(
      join(root, "old-context.json"),
      JSON.stringify({
        source: { kind: "file", target: "missing-should-not-be-read" },
      }),
    );
    paths.aggregate.checkpoint = "checkpoint.json";
    writeFileSync(
      join(root, "checkpoint.json"),
      JSON.stringify({ schema_version: 1 }),
    );
    const loaded = loadProjectRecommendation(root, paths);
    assert.deepEqual(loaded.planning.previous.project, i.project);
    assert.deepEqual(loaded.aggregate.checkpoint, { schema_version: 1 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("AC7 loader rejects combined bytes even when each file fits", () => {
  const { root, paths } = disk();
  try {
    for (let n = 0; n < 7; n++)
      writeFileSync(
        join(root, "large-" + n + ".json"),
        JSON.stringify("x".repeat(800000)),
      );
    paths.project = "large-0.json";
    paths.deliveryPlan = "large-1.json";
    paths.team = "large-2.json";
    paths.context = "large-3.json";
    paths.aggregate.context = "large-4.json";
    paths.planning.replan_decisions = "large-5.json";
    paths.planning.previous = {
      project: "large-6.json",
      deliveryPlan: paths.deliveryPlan,
      context: paths.context,
    };
    assert.throws(
      () => loadProjectRecommendation(root, paths),
      /^Error: load_size$/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("AC7 FIFO rejected without blocking", () => {
  const { root, paths } = disk();
  try {
    const child = spawnSync("mkfifo", [join(root, "pipe")], {
      encoding: "utf8",
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0);
    paths.context = "pipe";
    assert.throws(
      () => loadProjectRecommendation(root, paths),
      /^Error: load_invalid$/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("AC6 result schema prevents non-resume stage suggestion", () => {
  const r = recommendNextWork(input());
  r.selected_action.next_stage = "implementation";
  assert.equal(validateRecommendationArtifact("result", r).valid, false);
});
test("AC6 result schema forbids action while blocked", () => {
  const r = recommendNextWork(input());
  r.status = "blocked";
  assert.equal(validateRecommendationArtifact("result", r).valid, false);
});

test("AC7 extra aggregate Issue cannot crash pre-aggregation ranking", () => {
  const i = input(),
    r = clone(i.aggregate.context.issues[0]);
  r.work_id = "issue-99";
  r.issue_ref = "https://github.com/example/project/issues/99";
  r.feature_id = "unknown-feature";
  i.aggregate.context.issues.push(r);
  no(i);
});
test("AC7 target Issue with mismatched feature stops before ranking", () => {
  const i = input();
  i.aggregate.context.issues[0].feature_id = "unknown-feature";
  no(i);
});

test("AC7 100 managed workflows cold reruns actual Issue checkers", () => {
  const script = `const start=performance.now();const {recommendNextWork}=await import('./tools/workflow-project/recommend.mjs');const {hundredManaged}=await import('./tests/workflow-recommend/helpers.mjs');const r=recommendNextWork(hundredManaged());process.stdout.write(JSON.stringify({ms:performance.now()-start,status:r.status,decision:r.decision,work:r.selected_action?.work_id}));`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd: new URL("../../", import.meta.url),
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  const r = JSON.parse(child.stdout);
  assert.equal(r.status, "pass");
  assert.equal(r.decision, "claim_request");
  assert.equal(r.work, "issue-1");
  assert.ok(r.ms < 10000, JSON.stringify(r));
  console.log("recommend_managed_cold_ms=" + Math.round(r.ms));
});
