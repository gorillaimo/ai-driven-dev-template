import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { runActionsEntry } from "../../tools/workflow-github/actions-entry.mjs";
const env = (root) => ({
  RUNNER_TEMP: root,
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "gorillaimo/ai-driven-dev-template",
  GITHUB_REPOSITORY_ID: "1225812134",
  GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_RUN_ID: "123",
  GITHUB_ACTOR: "gorillaimo",
  GITHUB_WORKFLOW_REF:
    "gorillaimo/ai-driven-dev-template/.github/workflows/github-boundary-trial.yml@refs/heads/main",
  TRIAL_CONFIRMATION: "run-sandbox-1446360916-issue-1",
  TRIAL_SOURCE_SHA: "a".repeat(40),
  GITHUB_SHA: "b".repeat(40),
});
test("entry only materializes the key in the dedicated phase and removes it on cleanup", async () => {
  const root = mkdtempSync(join(tmpdir(), "actions-entry-")),
    e = env(root),
    key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export(
      { type: "pkcs8", format: "pem" },
    );
  e.TRIAL_GITHUB_APP_PRIVATE_KEY = key;
  const p = await runActionsEntry(["prepare-key"], {
    environment: e,
    sourceSha: "a".repeat(40),
  });
  assert.equal(p.exit_code, 0, JSON.stringify(p));
  assert.equal(e.TRIAL_GITHUB_APP_PRIVATE_KEY, undefined);
  assert.ok(!JSON.stringify(p).includes("PRIVATE KEY"));
  assert.equal(existsSync(join(root, "workflow-github-trial/app.pem")), true);
  assert.equal(
    (
      await runActionsEntry(["cleanup"], {
        environment: e,
        sourceSha: "a".repeat(40),
      })
    ).exit_code,
    0,
  );
  assert.equal(existsSync(join(root, "workflow-github-trial/app.pem")), false);
});
test("missing artifacts and invalid/rerun context are never reported as verified", async () => {
  const root = mkdtempSync(join(tmpdir(), "actions-entry-missing-"));
  for (const [args, e] of [
    [["summary"], env(root)],
    [["run"], { ...env(root), GITHUB_RUN_ATTEMPT: "2" }],
    [["unknown"], env(root)],
  ]) {
    const r = await runActionsEntry(args, {
      environment: e,
      sourceSha: "a".repeat(40),
      run: async () => {
        throw Error("SECRET_CANARY");
      },
    });
    assert.notEqual(r.exit_code, 0);
    assert.ok(!r.output.includes("SECRET_CANARY"));
  }
});
