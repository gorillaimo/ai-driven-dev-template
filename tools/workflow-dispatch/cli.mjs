import {
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  constants,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { parseYaml } from "workflow-rules/load";
import { validateProjectV2 } from "./check.mjs";
import { planBatch } from "./plan.mjs";
import { previewMigration } from "./migrate.mjs";
import { validateDispatchArtifact } from "./schema.mjs";
import { safe, fail } from "./core.mjs";
import { messages } from "./messages.mjs";
// This CLI only reads explicitly named data files. It has no storage writer,
// credential discovery, network client, worker startup or mutation command.
function inputFile(path) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) fail("input_invalid");
    const raw = readFileSync(fd, "utf8");
    if (Buffer.byteLength(raw) > 5 * 1024 * 1024) fail("input_invalid");
    const value = parseYaml(raw);
    if (!safe(value)) fail("input_invalid");
    return value;
  } finally {
    closeSync(fd);
  }
}
export async function runCli(args) {
  const json = Array.isArray(args) && args.includes("--json");
  try {
    if (
      !Array.isArray(args) ||
      args.length > 4 ||
      !["check", "plan", "migration", "status"].includes(args[0]) ||
      args[1] !== "--input" ||
      typeof args[2] !== "string" ||
      !args[2] ||
      (args.length !== 3 && !(args.length === 4 && args[3] === "--json"))
    )
      fail("input_invalid");
    const input = inputFile(args[2]);
    let r;
    if (args[0] === "check")
      r = { ...validateProjectV2(input), authority: false };
    else if (args[0] === "plan") r = planBatch(input);
    else if (args[0] === "migration") r = previewMigration(input);
    else {
      if (!validateDispatchArtifact("ledger-view", input).valid)
        fail("input_invalid");
      r = {
        status: input.status,
        authority: false,
        generation: input.generation,
        active_claims: input.claims.length,
        pending_operations: input.pending_operations.length,
        diagnostics: [],
      };
    }
    if (Buffer.byteLength(JSON.stringify(r)) > 1024 * 1024)
      fail("input_invalid");
    return {
      exitCode: ["passed", "ready"].includes(r.status) ? 0 : 1,
      output: json
        ? JSON.stringify(r)
        : [
            messages[r.status] ?? messages.blocked,
            ...(r.diagnostics ?? []),
          ].join("\n"),
    };
  } catch {
    return {
      exitCode: 1,
      output: json
        ? JSON.stringify({
            status: "blocked",
            authority: false,
            diagnostics: ["input_invalid"],
          })
        : messages.input_invalid,
    };
  }
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const r = await runCli(process.argv.slice(2));
  process.stdout.write(r.output + "\n");
  process.exitCode = r.exitCode;
}
