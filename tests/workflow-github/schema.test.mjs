import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseYaml } from "../../tools/workflow-rules/load.mjs";
import { validateGitHubArtifact } from "../../tools/workflow-github/schema.mjs";
for (const kind of [
  "policy",
  "snapshot",
  "session-request",
  "authorization",
  "operation",
  "receipt",
])
  test("github/v1 " + kind + " example is strict and remains synthetic", () => {
    const value = parseYaml(
      readFileSync(
        new URL(
          "../../.ai-workflow/templates/github/v1/" + kind + ".yaml",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.equal(validateGitHubArtifact(kind, value).valid, true);
    for (const bad of [
      { ...value, schema_version: 2 },
      { ...value, unknown: true },
      { ...value, schema_version: undefined },
    ])
      assert.equal(validateGitHubArtifact(kind, bad).valid, false);
  });
