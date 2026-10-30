import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateProject,
  validateAggregateArtifact,
} from "../../tools/workflow-project/aggregate.mjs";
import { loadProjectAggregate } from "../../tools/workflow-project/aggregate-load.mjs";
import { input, clone, large, bind } from "./helpers.mjs";
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
for (const [n, mutate] of [
  [
    "getter",
    (i) =>
      Object.defineProperty(i, "bad", {
        enumerable: true,
        get() {
          throw Error("CANARY");
        },
      }),
  ],
  ["cycle", (i) => (i.loop = i)],
  ["function", (i) => (i.bad = () => {})],
  ["symbol", (i) => (i[Symbol("CANARY")] = 1)],
  ["hole", (i) => (i.workflows = Array(1))],
  ["NaN", (i) => (i.bad = NaN)],
  [
    "depth",
    (i) => {
      let o = {};
      i.project.extensions = o;
      for (let n = 0; n < 33; n++) o = o.child = {};
    },
  ],
  [
    "size",
    (i) => (i.project.extensions = { text: "x".repeat(5 * 1024 * 1024) }),
  ],
  [
    "issues",
    (i) =>
      (i.context.issues = Array.from({ length: 101 }, () =>
        clone(i.context.issues[0]),
      )),
  ],
])
  test("safe reject " + n, () => {
    const i = input();
    mutate(i);
    const r = aggregateProject(i);
    assert.equal(r.status, "blocked");
    assert.ok(!JSON.stringify(r).includes("CANARY"));
    assert.equal(validateAggregateArtifact("result", r).valid, true);
  });
function temp(fn) {
  const root = mkdtempSync(join(tmpdir(), "aggregate-"));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
function save(root) {
  const i = input(),
    paths = {};
  for (const k of ["project", "deliveryPlan", "context"]) {
    paths[k] = k + ".json";
    writeFileSync(join(root, paths[k]), JSON.stringify(i[k]));
  }
  paths.workflows = [];
  return paths;
}
test("loader reads only explicit local paths and leaves files intact", () =>
  temp((root) => {
    const paths = save(root),
      before = readFileSync(join(root, "context.json"), "utf8"),
      i = loadProjectAggregate(root, paths);
    assert.equal(aggregateProject(i).status, "pass");
    assert.equal(readFileSync(join(root, "context.json"), "utf8"), before);
  }));
for (const p of ["../escape", "/etc/passwd", "https://example.org", "a/../b"])
  test("unsafe loader " + p, () =>
    temp((root) => {
      const paths = save(root);
      paths.context = p;
      assert.throws(() => loadProjectAggregate(root, paths), /load_/);
    }),
  );
for (const s of [
  "x: 1\nx: 2",
  "x: &a [1]\ny: *a",
  "---\nx: 1\n---\nx: 2",
  "x: !custom abc",
])
  test("strict YAML " + s.split("\n")[0], () =>
    temp((root) => {
      const paths = save(root);
      writeFileSync(join(root, paths.context), s);
      assert.throws(() => loadProjectAggregate(root, paths), /load_/);
    }),
  );
test("symlink and directory rejected", () =>
  temp((root) => {
    const paths = save(root);
    symlinkSync("context.json", join(root, "alias"));
    paths.context = "alias";
    assert.throws(() => loadProjectAggregate(root, paths), /load_/);
    mkdirSync(join(root, "dir"));
    paths.context = "dir";
    assert.throws(() => loadProjectAggregate(root, paths), /load_/);
  }));
test("loader enforces 1 MiB file boundary", () =>
  temp((root) => {
    const paths = save(root),
      p = join(root, "context.json"),
      s = readFileSync(p, "utf8");
    writeFileSync(p, s + " ".repeat(1024 * 1024 - Buffer.byteLength(s)));
    assert.equal(
      aggregateProject(loadProjectAggregate(root, paths)).status,
      "pass",
    );
    writeFileSync(p, s + " ".repeat(1024 * 1024));
    assert.throws(() => loadProjectAggregate(root, paths), /load_/);
  }));
test("result rejects unknown fields/version and unauthorized statuses", () => {
  for (const change of [
    (r) => (r.schema_version = 2),
    (r) => (r.status = "authorized"),
    (r) => (r.secret = true),
  ]) {
    const r = aggregateProject(input());
    change(r);
    assert.equal(validateAggregateArtifact("result", r).valid, false);
  }
});
test("cold offline representative max within five seconds", () => {
  const t = performance.now();
  const r = spawnSync(
    process.execPath,
    [
      "--import",
      "./tests/workflow-members/offline.mjs",
      "--input-type=module",
      "-e",
      "import {aggregateProject} from './tools/workflow-project/aggregate.mjs';import {largeManaged} from './tests/workflow-aggregate/helpers.mjs';const r=aggregateProject(largeManaged());if(r.status!=='pass'||r.counts.issue_count!==100)process.exit(1);console.log('pass')",
    ],
    {
      cwd: new URL("../../", import.meta.url),
      encoding: "utf8",
      timeout: 5000,
    },
  );
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "pass");
  assert.ok(performance.now() - t < 5000);
});
test("throwing proxy cannot leak its exception", () => {
  const p = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw Error("CANARY_PROXY");
      },
    },
  );
  assert.equal(aggregateProject(p).status, "blocked");
});
for (const [name, change] of [
  [
    "feature",
    (i) =>
      (i.deliveryPlan.features = Array.from({ length: 1001 }, () =>
        clone(i.deliveryPlan.features[0]),
      )),
  ],
  ["area", (i) => (i.project.areas = Array(201).fill(i.project.areas[0]))],
  ["bundle", (i) => (i.workflows = Array(101).fill({}))],
  [
    "event",
    (i) =>
      (i.workflows = [
        {
          issue_ref: i.context.issues[0].issue_ref,
          input: { state: { history: Array(1001).fill({}) } },
        },
      ]),
  ],
  ["claims", (i) => (i.context.issues[0].claims = Array(101).fill({}))],
  ["TTL zero", (i) => (i.context.freshness_limit_seconds = 0)],
  ["TTL too large", (i) => (i.context.freshness_limit_seconds = 86401)],
  [
    "actor proxy missing",
    (i) =>
      (i.context.recorded_by = { actor_type: "ai_agent", actor_ref: "codex" }),
  ],
])
  test("bounds " + name, () => {
    const i = input();
    change(i);
    assert.equal(aggregateProject(i).status, "blocked");
  });
test("diagnostic limit yields safe bounded output", () => {
  const i = large();
  i.context.issues = [];
  i.context.feature_confirmations = [];
  const f = i.deliveryPlan.features[0];
  i.deliveryPlan.features = Array.from({ length: 1000 }, (_, n) => ({
    ...clone(f),
    feature_id: "f" + n,
    issue_refs: [],
  }));
  bind(i);
  const r = aggregateProject(i);
  assert.equal(r.status, "blocked");
  assert.ok(r.diagnostics.length <= 1000);
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 1024 * 1024);
});
test("FIFO input rejected without blocking", () =>
  temp((root) => {
    const paths = save(root),
      p = join(root, "pipe");
    const c = spawnSync("mkfifo", [p], { encoding: "utf8" });
    assert.ifError(c.error);
    assert.equal(c.status, 0);
    paths.context = "pipe";
    assert.throws(() => loadProjectAggregate(root, paths), /load_/);
  }));
test("managed loader accepts only explicit bundles, including rule data", () =>
  temp((root) => {
    const paths = save(root);
    paths.workflows = [
      {
        issue_ref: "https://github.com/example/project/issues/1",
        plan: "project.json",
        state: "missing.json",
        context: "context.json",
        ruleInput: "project.json",
      },
    ];
    assert.throws(() => loadProjectAggregate(root, paths), /load_/);
    paths.workflows[0].secret = "CANARY";
    assert.throws(() => loadProjectAggregate(root, paths), /load_paths/);
  }));
test("oversized checkpoint in result is blocked with no partial checkpoint", () => {
  const i = input();
  i.checkpoint = {
    schema_version: 1,
    ...Object.fromEntries(
      [
        "project_id",
        "repository",
        "project_revision",
        "plan_revision",
        "project_digest",
        "plan_digest",
        "observed_at",
      ].map((k) => [k, i.context[k]]),
    ),
    source_input_digest: "0".repeat(64),
    issues: [
      {
        issue_ref: i.context.issues[0].issue_ref,
        work_id: "issue-1",
        events: Array.from({ length: 7000 }, (_, n) => ({
          event_id: "e" + n + "x".repeat(120),
          digest: "0".repeat(64),
        })),
      },
    ],
  };
  const r = aggregateProject(i);
  assert.equal(r.status, "blocked");
  assert.equal(r.checkpoint, null);
  assert.ok(r.diagnostics.some((d) => d.code === "output_limit"));
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 1024 * 1024);
});
test("aggregate loader cumulative read limit", () =>
  temp((root) => {
    const paths = save(root),
      p = join(root, "project.json"),
      s = readFileSync(p, "utf8");
    writeFileSync(p, s + " ".repeat(1024 * 1024 - Buffer.byteLength(s)));
    paths.workflows = [
      {
        issue_ref: "https://github.com/example/project/issues/1",
        plan: "project.json",
        state: "project.json",
        context: "project.json",
        ruleInput: "project.json",
      },
    ];
    assert.throws(() => loadProjectAggregate(root, paths), /load_size/);
  }));
