import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../tools/workflow-github/cli.mjs";
import { fixture } from "./fixture.mjs";
test("CLI validates locally without constructing a live transport", async () => {
  const s = fixture(),
    dir = mkdtempSync(join(tmpdir(), "github-cli-")),
    input = join(dir, "policy.yaml");
  writeFileSync(input, JSON.stringify(s.policy));
  let calls = 0;
  try {
    const r = await runCli(["validate", "--kind", "policy", "--input", input], {
      transportFactory: () => {
        calls++;
        throw Error();
      },
    });
    assert.equal(r.exit_code, 0);
    assert.equal(r.summary.valid, true);
    assert.equal(calls, 0);
    const duplicate = readFileSync(input, "utf8").replace(
      '"schema_version":1',
      '"schema_version":1,"schema_version":1',
    );
    writeFileSync(input, duplicate);
    assert.notEqual(
      (await runCli(["validate", "--kind", "policy", "--input", input]))
        .exit_code,
      0,
    );
  } finally {
    s.close();
  }
});
test("collection writes only a new private output file, without raw text in summary", async () => {
  const s = fixture(),
    dir = mkdtempSync(join(tmpdir(), "github-collect-")),
    input = join(dir, "input.json");
  writeFileSync(
    input,
    JSON.stringify({
      policy: s.policy,
      scope: { approval_sources: [], actors: [] },
    }),
  );
  try {
    const ctx = {
      transportFactory: () => ({}),
      collect: async () => s.snapshot,
    };
    const r = await runCli(["collect", "--input", input, "--output", dir], ctx);
    assert.equal(r.exit_code, 0, JSON.stringify(r));
    assert.equal(
      JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8"))
        .artifact_kind,
      "github-snapshot",
    );
    assert.notEqual(
      (await runCli(["collect", "--input", input, "--output", dir], ctx))
        .exit_code,
      0,
    );
    assert.ok(!JSON.stringify(r.summary).includes("Synthetic contract"));
  } finally {
    s.close();
  }
});
test("invalid CLI arguments and parser inputs have fixed diagnostics", async () => {
  for (const args of [
    [],
    ["collect", "--input", "SECRET_CANARY"],
    ["validate", "--kind", "bad", "--input", "SECRET_CANARY"],
    ["validate", "--input", "a", "--input", "b"],
  ]) {
    const r = await runCli(args);
    assert.notEqual(r.exit_code, 0);
    assert.ok(!JSON.stringify(r).includes("SECRET_CANARY"));
  }
});
