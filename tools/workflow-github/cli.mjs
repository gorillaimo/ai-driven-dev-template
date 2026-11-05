import {
  readFileSync,
  lstatSync,
  realpathSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  constants,
} from "node:fs";
import { resolve, relative, sep, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseYaml } from "workflow-rules/load";
import { badJson, fail, errorCode } from "./core.mjs";
import { validateGitHubArtifact } from "./schema.mjs";
import { collectGitHubSnapshot } from "./collector.mjs";
import { createRestTransport } from "./transport.mjs";

function inputFile(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1048576)
    fail("input_file_invalid");
  const value = parseYaml(readFileSync(path, "utf8"));
  if (badJson(value)) fail("input_invalid");
  return value;
}
function writeSnapshot(directory, value) {
  const root = realpathSync(directory),
    rel = relative(realpathSync(new URL("../../", import.meta.url)), root),
    stat = lstatSync(root);
  if (
    root !== resolve(directory) ||
    !stat.isDirectory() ||
    stat.mode & 0o077 ||
    !(rel === ".." || rel.startsWith(".." + sep))
  )
    fail("output_directory_invalid");
  if (badJson(value) || !validateGitHubArtifact("snapshot", value).valid)
    fail("snapshot_invalid");
  const raw = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(raw) > 1048576) fail("output_limit");
  const fd = openSync(
    join(root, "snapshot.json"),
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, raw);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export async function runCli(
  args,
  {
    transportFactory = createRestTransport,
    collect = collectGitHubSnapshot,
  } = {},
) {
  try {
    if (
      !Array.isArray(args) ||
      args.length > 7 ||
      !["validate", "collect"].includes(args[0])
    )
      fail("arguments_invalid");
    const options = {};
    for (let i = 1; i < args.length; i += 2) {
      const key = args[i];
      if (
        !["--kind", "--input", "--output"].includes(key) ||
        !args[i + 1] ||
        options[key]
      )
        fail("arguments_invalid");
      options[key] = args[i + 1];
    }
    if (
      !options["--input"] ||
      (args[0] === "validate" && (!options["--kind"] || options["--output"])) ||
      (args[0] === "collect" && (!options["--output"] || options["--kind"]))
    )
      fail("arguments_invalid");
    const value = inputFile(options["--input"]);
    if (args[0] === "validate") {
      if (
        ![
          "policy",
          "snapshot",
          "session-request",
          "authorization",
          "operation",
          "receipt",
        ].includes(options["--kind"])
      )
        fail("kind_invalid");
      const valid = validateGitHubArtifact(options["--kind"], value).valid;
      return {
        exit_code: valid ? 0 : 2,
        summary: {
          status: "format_check",
          valid,
          not_evaluated: ["identity", "approval", "live_execution"],
        },
      };
    }
    if (!value || !validateGitHubArtifact("policy", value.policy).valid)
      fail("input_invalid");
    const transport = transportFactory({
      repository: value.policy.repository,
      repositoryId: value.policy.repository_id,
      mode: "read_only",
    });
    const result = await collect(value, transport);
    writeSnapshot(options["--output"], result);
    return {
      exit_code:
        result.status === "complete" && !result.unresolved.length ? 0 : 2,
      summary: {
        status: result.status,
        issue_count: result.issues.length,
        pr_count: result.prs.length,
        branch_count: result.branches.length,
        source_count: result.sources.length,
        unresolved_count: result.unresolved.length,
        not_evaluated: ["identity", "approval", "write_authority"],
      },
    };
  } catch (error) {
    return {
      exit_code: 2,
      summary: {
        status: "failed",
        diagnostics: [{ code: errorCode(error, "input_or_output_failed") }],
      },
    };
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const r = await runCli(process.argv.slice(2));
  process.stdout.write(JSON.stringify(r.summary) + "\n");
  process.exitCode = r.exit_code;
}
