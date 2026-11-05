import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseYaml } from "../../tools/workflow-rules/load.mjs";
import { fixture, migrationInput } from "./fixture.mjs";
import { runCli } from "../../tools/workflow-dispatch/cli.mjs";
import { validateProjectV2 } from "../../tools/workflow-dispatch/check.mjs";
import { validateDispatchArtifact } from "../../tools/workflow-dispatch/schema.mjs";
test("read-only CLI checks, plans and previews migration without opening a ledger", async () => {
  const root = mkdtempSync(join(tmpdir(), "dispatch-cli-"));
  try {
    const f = fixture();
    for (const [command, input] of [
      ["check", f],
      ["plan", f],
      ["migration", migrationInput()],
      ["status", f.ledger],
    ]) {
      const file = join(root, "input.json");
      writeFileSync(file, JSON.stringify(input));
      const r = await runCli([command, "--input", file, "--json"]);
      assert.equal(r.exitCode, 0, JSON.stringify(r));
      assert.notEqual(JSON.parse(r.output).authority, true);
    }
    const p = join(root, "bad.json");
    writeFileSync(
      p,
      JSON.stringify({
        ...f,
        ledger: { ...f.ledger, status: "recovery_required" },
      }),
    );
    assert.equal((await runCli(["plan", "--input", p])).exitCode, 1);
    const linked = join(root, "linked");
    symlinkSync(p, linked);
    assert.equal((await runCli(["check", "--input", linked])).exitCode, 1);
    assert.equal((await runCli(["reserve", "--input", p])).exitCode, 1);
    assert.equal(
      (await runCli(["check", "--input", p, "--input", p])).exitCode,
      1,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("synthetic Project v2 and Dispatcher templates remain valid contracts", () => {
  const read = (p) =>
    parseYaml(
      readFileSync(
        new URL("../../.ai-workflow/templates/" + p, import.meta.url),
        "utf8",
      ),
    );
  const cfg = {
    project: read("project/v2/project.yaml"),
    team: read("project/v2/team.yaml"),
    deliveryPlan: read("project/v2/delivery-plan.yaml"),
  };
  assert.equal(validateProjectV2(cfg).status, "passed");
  for (const kind of [
    "request",
    "migration",
    "batch-plan",
    "ledger-view",
    "transition",
  ])
    assert.equal(
      validateDispatchArtifact(kind, read("dispatch/v1/" + kind + ".yaml"))
        .valid,
      true,
      kind,
    );
});
