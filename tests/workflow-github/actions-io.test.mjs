import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import {
  admitActionsEnvironment,
  prepareTrialKey,
  openTrialPaths,
  removeTrialKey,
  writeTrialReport,
} from "../../tools/workflow-github/actions-io.mjs";
const sourceRoot = new URL("../../", import.meta.url),
  sha = "a".repeat(40);
const environment = () => ({
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
  TRIAL_SOURCE_SHA: sha,
  GITHUB_SHA: "b".repeat(40),
});
test("manual runner admission rejects forks, PRs, reruns, wrong source and missing confirmation", () => {
  assert.equal(admitActionsEnvironment(environment(), sha).runId, "trial-123");
  for (const change of [
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REPOSITORY_ID: "1" },
    { GITHUB_RUN_ATTEMPT: "2" },
    { TRIAL_CONFIRMATION: "do-not-run" },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_ACTOR: "other" },
    { TRIAL_SOURCE_SHA: "c".repeat(40) },
  ])
    assert.throws(() =>
      admitActionsEnvironment({ ...environment(), ...change }, sha),
    );
});
test("key is materialized only into a new private directory and removed without printing contents", () => {
  const root = mkdtempSync(join(tmpdir(), "trial-key-")),
    key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export(
      { type: "pkcs8", format: "pem" },
    );
  const p = prepareTrialKey({ runnerTemp: root, sourceRoot, key });
  assert.equal(statSync(p.directory).mode & 0o777, 0o700);
  assert.equal(statSync(p.keyPath).mode & 0o777, 0o600);
  assert.equal(readFileSync(p.keyPath, "utf8"), key);
  assert.throws(() => prepareTrialKey({ runnerTemp: root, sourceRoot, key }));
  assert.equal(removeTrialKey(p), true);
  assert.ok(!JSON.stringify(p).includes("PRIVATE KEY"));
});
test("invalid key and symlinked directory are rejected, not repaired", () => {
  const root = mkdtempSync(join(tmpdir(), "trial-key-invalid-"));
  assert.throws(
    () =>
      prepareTrialKey({ runnerTemp: root, sourceRoot, key: "SECRET_CANARY" }),
    (e) => !e.message.includes("SECRET_CANARY"),
  );
  symlinkSync(root, join(root, "workflow-github-trial"));
  assert.throws(() => openTrialPaths({ runnerTemp: root, sourceRoot }));
});
test("public report exporter rejects unknown/raw fields", () => {
  const root = mkdtempSync(join(tmpdir(), "trial-public-")),
    key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export(
      { type: "pkcs8", format: "pem" },
    );
  const p = prepareTrialKey({ runnerTemp: root, sourceRoot, key });
  try {
    assert.throws(() =>
      writeTrialReport(p, { status: "passed", raw: "SECRET_CANARY" }),
    );
  } finally {
    removeTrialKey(p);
  }
});
