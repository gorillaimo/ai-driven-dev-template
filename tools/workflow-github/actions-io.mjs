import {
  mkdirSync,
  lstatSync,
  realpathSync,
  openSync,
  closeSync,
  writeFileSync,
  fsyncSync,
  unlinkSync,
  constants,
  readFileSync,
} from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { createPrivateKey } from "node:crypto";
import { badJson, fail, NOT_EVALUATED } from "./core.mjs";
import { validateGitHubArtifact } from "./schema.mjs";

export function admitActionsEnvironment(e, sourceSha) {
  if (
    e.GITHUB_ACTIONS !== "true" ||
    e.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    e.GITHUB_REPOSITORY !== "gorillaimo/ai-driven-dev-template" ||
    e.GITHUB_REPOSITORY_ID !== "1225812134" ||
    e.GITHUB_REF !== "refs/heads/main" ||
    e.GITHUB_RUN_ATTEMPT !== "1" ||
    e.GITHUB_ACTOR !== "gorillaimo" ||
    e.GITHUB_WORKFLOW_REF !==
      "gorillaimo/ai-driven-dev-template/.github/workflows/github-boundary-trial.yml@refs/heads/main" ||
    e.TRIAL_CONFIRMATION !== "run-sandbox-1446360916-issue-1" ||
    !/^[1-9][0-9]{0,30}$/.test(e.GITHUB_RUN_ID ?? "") ||
    !/^[a-f0-9]{40}$/.test(e.TRIAL_SOURCE_SHA ?? "") ||
    e.TRIAL_SOURCE_SHA !== sourceSha ||
    !/^[a-f0-9]{40}$/.test(e.GITHUB_SHA ?? "")
  )
    fail("actions_admission_denied");
  return {
    runId: "trial-" + e.GITHUB_RUN_ID,
    sourceSha,
    workflowSha: e.GITHUB_SHA,
  };
}
function outside(root, sourceRoot) {
  const source = realpathSync(sourceRoot),
    rel = relative(source, root);
  return rel === ".." || rel.startsWith(".." + sep);
}
export function openTrialPaths({ runnerTemp, sourceRoot }) {
  if (
    typeof runnerTemp !== "string" ||
    realpathSync(runnerTemp) !== resolve(runnerTemp)
  )
    fail("trial_directory_invalid");
  const directory = join(runnerTemp, "workflow-github-trial");
  if (
    realpathSync(directory) !== directory ||
    lstatSync(directory).isSymbolicLink() ||
    !lstatSync(directory).isDirectory() ||
    lstatSync(directory).mode & 0o077 ||
    !outside(directory, sourceRoot)
  )
    fail("trial_directory_invalid");
  return {
    directory,
    keyPath: join(directory, "app.pem"),
    journalDirectory: join(directory, "journal"),
    reportPath: join(directory, "public-report.json"),
  };
}
export function prepareTrialKey({ runnerTemp, sourceRoot, key }) {
  try {
    if (
      typeof key !== "string" ||
      Buffer.byteLength(key) > 16384 ||
      createPrivateKey(key).asymmetricKeyType !== "rsa" ||
      typeof runnerTemp !== "string" ||
      realpathSync(runnerTemp) !== resolve(runnerTemp) ||
      !outside(runnerTemp, sourceRoot)
    )
      fail("trial_key_invalid");
    mkdirSync(join(runnerTemp, "workflow-github-trial"), { mode: 0o700 });
    const paths = openTrialPaths({ runnerTemp, sourceRoot });
    const fd = openSync(
      paths.keyPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeFileSync(fd, key);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const dir = openSync(
      paths.directory,
      constants.O_RDONLY | constants.O_DIRECTORY,
    );
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
    return paths;
  } catch {
    fail("trial_key_preparation_failed");
  }
}
export function removeTrialKey(paths) {
  try {
    const s = lstatSync(paths.keyPath);
    if (s.isSymbolicLink() || !s.isFile() || s.mode & 0o077)
      fail("trial_key_cleanup_failed");
    unlinkSync(paths.keyPath);
    return true;
  } catch (e) {
    if (e?.code === "ENOENT") return true;
    fail("trial_key_cleanup_failed");
  }
}
export function validTrialReport(r) {
  const keys = [
    "version",
    "status",
    "mode",
    "source_sha",
    "workflow_sha",
    "manifest_digest",
    "run_id",
    "repository",
    "repository_id",
    "issue_number",
    "app_id",
    "installation_id",
    "request_count",
    "token_revocation",
    "key_cleanup",
    "receipts",
    "journal_digest",
    "diagnostics",
    "not_evaluated",
  ];
  if (
    badJson(r) ||
    !r ||
    Object.keys(r).some((k) => !keys.includes(k)) ||
    keys.some((k) => !Object.hasOwn(r, k)) ||
    r.version !== 1 ||
    !["passed", "blocked", "unknown", "not_evaluated"].includes(r.status) ||
    !["live", "synthetic"].includes(r.mode) ||
    !["source_sha", "workflow_sha", "manifest_digest", "journal_digest"].every(
      (k) =>
        new RegExp(
          k.endsWith("_sha") ? "^[a-f0-9]{40}$" : "^[a-f0-9]{64}$",
        ).test(r[k]),
    ) ||
    !/^[a-z0-9_-]{1,128}$/.test(r.run_id) ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r.repository) ||
    !["repository_id", "issue_number", "app_id", "installation_id"].every(
      (k) => Number.isSafeInteger(r[k]) && r[k] > 0,
    ) ||
    !Number.isSafeInteger(r.request_count) ||
    r.request_count < 0 ||
    r.request_count > 100 ||
    !["revoked", "unknown", "not_issued"].includes(r.token_revocation) ||
    !["pending", "removed", "unknown"].includes(r.key_cleanup) ||
    !Array.isArray(r.receipts) ||
    r.receipts.length > 5 ||
    r.receipts.some((v) => !validateGitHubArtifact("receipt", v).valid) ||
    !Array.isArray(r.diagnostics) ||
    r.diagnostics.length > 1000 ||
    r.diagnostics.some(
      (v) =>
        !v ||
        typeof v !== "object" ||
        Object.keys(v).join() !== "code" ||
        !/^[a-z0-9_]{1,128}$/.test(v.code),
    ) ||
    !Array.isArray(r.not_evaluated) ||
    r.not_evaluated.some(
      (v) => ![...NOT_EVALUATED, "live_github"].includes(v),
    ) ||
    (r.status === "passed" &&
      (r.token_revocation !== "revoked" || r.key_cleanup !== "removed"))
  )
    return false;
  return Buffer.byteLength(JSON.stringify(r)) <= 1048576;
}
export function writeTrialReport(paths, value) {
  if (!validTrialReport(value)) fail("public_report_invalid");
  const fd = openSync(
    paths.reportPath,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function readTrialReport(paths) {
  try {
    const s = lstatSync(paths.reportPath);
    if (!s.isFile() || s.isSymbolicLink() || s.size > 1048576)
      fail("public_report_invalid");
    const r = JSON.parse(readFileSync(paths.reportPath, "utf8"));
    if (!validTrialReport(r)) fail("public_report_invalid");
    return r;
  } catch {
    fail("public_report_invalid");
  }
}
