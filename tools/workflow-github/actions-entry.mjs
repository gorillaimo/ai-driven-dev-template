import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  admitActionsEnvironment,
  prepareTrialKey,
  openTrialPaths,
  removeTrialKey,
  writeTrialReport,
  readTrialReport,
} from "./actions-io.mjs";
import { runActionsTrial } from "./actions-controller.mjs";
import { fail, errorCode } from "./core.mjs";

const sourceRoot = new URL("../../", import.meta.url);
function summary(r) {
  return (
    "## GitHub限定実証\n\n結果: **" +
    r.status +
    "**（" +
    r.mode +
    "）\n\n対象: " +
    r.repository +
    " / Issue #" +
    r.issue_number +
    "\n\nAPI要求: " +
    r.request_count +
    "/100、token失効: " +
    r.token_revocation +
    "、一時鍵の削除: " +
    r.key_cleanup +
    "\n\n| 操作 | 状態 |\n| --- | --- |\n" +
    r.receipts
      .map((v) => "| " + v.operation_kind + " | " + v.status + " |")
      .join("\n") +
    "\n\n未評価: " +
    r.not_evaluated.join(", ") +
    "\n\n診断: " +
    (r.diagnostics.map((v) => v.code).join(", ") || "なし") +
    "\n\n実装commit: `" +
    r.source_sha +
    "`\n\n合成issuerは本物の人間認証を証明しません。未実行・部分成功・不明な結果は実証成功に含めません。\n"
  );
}
export async function runActionsEntry(args, options = {}) {
  try {
    if (
      !Array.isArray(args) ||
      args.length !== 1 ||
      !["prepare-key", "run", "cleanup", "summary"].includes(args[0])
    )
      fail("actions_arguments_invalid");
    const environment = options.environment ?? process.env,
      key = environment.TRIAL_GITHUB_APP_PRIVATE_KEY;
    // Remove the step-scoped secret before any subprocess can inherit it.
    delete environment.TRIAL_GITHUB_APP_PRIVATE_KEY;
    if (args[0] !== "prepare-key" && key !== undefined)
      fail("secret_in_wrong_step");
    const sourceSha =
      options.sourceSha ??
      execFileSync("git", ["--no-replace-objects", "rev-parse", "HEAD"], {
        cwd: sourceRoot,
        encoding: "utf8",
        env: { ...process.env, TRIAL_GITHUB_APP_PRIVATE_KEY: "" },
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }).trim();
    const context = admitActionsEnvironment(environment, sourceSha),
      locations = { runnerTemp: environment.RUNNER_TEMP, sourceRoot };
    if (args[0] === "prepare-key") {
      prepareTrialKey({ ...locations, key });
      return { exit_code: 0, output: '{"status":"key_prepared"}\n' };
    }
    const paths = openTrialPaths(locations);
    if (args[0] === "cleanup") {
      removeTrialKey(paths);
      let report;
      try {
        report = readTrialReport(paths);
      } catch {}
      if (report) {
        report.key_cleanup = "removed";
        writeTrialReport(paths, report);
      }
      return { exit_code: 0, output: '{"status":"key_removed"}\n' };
    }
    if (args[0] === "summary") {
      const r = readTrialReport(paths);
      return {
        exit_code:
          r.status === "passed" &&
          r.mode === "live" &&
          r.key_cleanup === "removed"
            ? 0
            : 2,
        output: summary(r),
      };
    }
    const manifest = JSON.parse(
      readFileSync(
        new URL(
          "../../.ai-workflow/github-trial/manifest.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const result = await (options.run ?? runActionsTrial)({
      paths,
      manifest,
      ...context,
    });
    writeTrialReport(paths, result);
    return {
      exit_code:
        result.status === "passed" &&
        result.mode === "live" &&
        result.key_cleanup === "removed"
          ? 0
          : 2,
      output:
        JSON.stringify({
          status: result.status,
          request_count: result.request_count,
          token_revocation: result.token_revocation,
          key_cleanup: result.key_cleanup,
          not_evaluated: result.not_evaluated,
        }) + "\n",
    };
  } catch (error) {
    return {
      exit_code: 2,
      output:
        JSON.stringify({
          status: "not_evaluated",
          diagnostics: [{ code: errorCode(error, "actions_entry_failed") }],
        }) + "\n",
    };
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const r = await runActionsEntry(process.argv.slice(2));
  process.stdout.write(r.output);
  process.exitCode = r.exit_code;
}
