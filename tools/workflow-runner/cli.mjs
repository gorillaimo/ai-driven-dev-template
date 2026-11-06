import {
  openSync,
  readFileSync,
  fstatSync,
  closeSync,
  constants,
  lstatSync,
  realpathSync,
  chmodSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createServer, request as httpRequest } from "node:http";
import { pathToFileURL } from "node:url";
import { parseYaml } from "workflow-rules/load";
import { safe, fail, code } from "./core.mjs";
import { valid } from "./core.mjs";
import { checkProfile } from "./core.mjs";
const messages = Object.freeze({
  passed: "検査に適合しました。実行権限の付与や実環境での検証は含みません。",
  running: "認証済み依頼を受け付けました。現在のrunの進捗を確認できます。",
  stopped: "停止を確認しました。成果と作業記録を保持します。",
  blocked: "確認が必要なため停止しています。診断コードを確認してください。",
  unknown:
    "結果を確認できません。再送や再割当の前に現在の状態を照合してください。",
  invalid: "入力または引数を確認してください。",
});
function privateSocket(socket) {
  if (
    typeof socket !== "string" ||
    socket !== resolve(socket) ||
    realpathSync(dirname(socket)) !== dirname(socket)
  )
    fail("socket_invalid");
  const p = lstatSync(dirname(socket));
  if (!p.isDirectory() || p.mode & 0o077 || p.uid !== process.getuid())
    fail("socket_invalid");
  const s = lstatSync(socket);
  if (!s.isSocket() || s.mode & 0o077 || s.uid !== process.getuid())
    fail("socket_invalid");
}
function inputFile(path) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > 1048576) fail("input_invalid");
    const raw = readFileSync(fd, "utf8");
    if (Buffer.byteLength(raw) > 1048576) fail("input_invalid");
    const v = parseYaml(raw);
    if (!safe(v)) fail("input_invalid");
    return v;
  } finally {
    closeSync(fd);
  }
}
async function control(socket, value) {
  privateSocket(socket);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        socketPath: socket,
        method: "POST",
        path: "/control",
        headers: { "content-type": "application/json" },
        timeout: 20000,
      },
      (res) => {
        let raw = "",
          bytes = 0;
        res.on("data", (b) => {
          bytes += b.length;
          if (bytes > 1048576) req.destroy();
          else raw += b;
        });
        res.on("error", () => reject(new Error("control_unknown")));
        res.on("end", () => {
          try {
            const r = JSON.parse(raw);
            if (!safe(r) || typeof r.status !== "string") throw Error();
            resolve(r);
          } catch {
            reject(new Error("control_unknown"));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => reject(new Error("control_unknown")));
    req.end(JSON.stringify({ request: value }));
  });
}
export async function runCli(args) {
  const json = Array.isArray(args) && args.includes("--json");
  try {
    if (
      !Array.isArray(args) ||
      args.length < 3 ||
      args.length > 8 ||
      !["check-profile", "status", "control"].includes(args[0])
    )
      fail("arguments_invalid");
    const flags = {};
    for (let i = 1; i < args.length; i++) {
      const k = args[i];
      if (k === "--json") {
        if (flags.json) fail("arguments_invalid");
        flags.json = true;
        continue;
      }
      if (
        !["--input", "--socket", "--at"].includes(k) ||
        flags[k] ||
        !args[i + 1] ||
        args[i + 1].startsWith("--")
      )
        fail("arguments_invalid");
      flags[k] = args[++i];
    }
    if (
      !flags["--input"] ||
      (args[0] !== "control" && flags["--socket"]) ||
      (args[0] !== "check-profile" && flags["--at"])
    )
      fail("arguments_invalid");
    const input = inputFile(flags["--input"]);
    let r;
    if (args[0] === "check-profile")
      r = checkProfile(input, flags["--at"] ?? new Date().toISOString());
    else if (args[0] === "status") {
      if (
        !safe(input) ||
        typeof input.recovery_required !== "boolean" ||
        !Array.isArray(input.attempts) ||
        !Array.isArray(input.runs)
      )
        fail("input_invalid");
      r = {
        status: input.recovery_required ? "blocked" : "passed",
        authority: false,
        active_attempts: input.attempts.filter((a) => !a.stopped).length,
        runs: input.runs.length,
      };
    } else {
      if (!flags["--socket"] || !valid("request", input))
        fail("request_invalid");
      r = await control(flags["--socket"], input);
    }
    const raw = JSON.stringify(r);
    if (Buffer.byteLength(raw) > 1048576) fail("output_limit");
    return {
      exitCode: ["passed", "running", "stopped"].includes(r.status) ? 0 : 1,
      output: json ? raw : (messages[r.status] ?? messages.blocked),
    };
  } catch (e) {
    return {
      exitCode: 1,
      output: json
        ? JSON.stringify({
            status: "blocked",
            authority: false,
            diagnostics: [code(e)],
          })
        : messages.invalid,
    };
  }
}
export async function serveControl({ socket, supervisor, resolveTasks }) {
  if (
    typeof supervisor?.accept !== "function" ||
    typeof resolveTasks !== "function" ||
    socket !== resolve(socket) ||
    realpathSync(dirname(socket)) !== dirname(socket)
  )
    fail("control_configuration_invalid");
  const dir = lstatSync(dirname(socket));
  if (!dir.isDirectory() || dir.mode & 0o077 || dir.uid !== process.getuid())
    fail("control_configuration_invalid");
  const server = createServer((req, res) => {
    let bytes = 0;
    const parts = [];
    req.on("error", () => {});
    req.on("data", (b) => {
      bytes += b.length;
      if (bytes > 1048576) req.destroy();
      else parts.push(b);
    });
    req.on("end", async () => {
      let r;
      try {
        if (req.method !== "POST" || req.url !== "/control")
          fail("control_route_invalid");
        const q = JSON.parse(Buffer.concat(parts).toString("utf8"));
        if (
          !safe(q) ||
          Object.keys(q).join() !== "request" ||
          !valid("request", q.request)
        )
          fail("control_request_invalid");
        r = await supervisor.accept(q.request, resolveTasks, { wait: false });
        if (!safe(r) || Buffer.byteLength(JSON.stringify(r)) > 1048576)
          fail("output_limit");
      } catch (e) {
        r = { status: "blocked", authority: false, diagnostics: [code(e)] };
      }
      if (!res.destroyed) {
        res.writeHead(r.status === "blocked" ? 403 : 200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify(r));
      }
    });
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 20000;
  server.maxHeadersCount = 10;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  chmodSync(socket, 0o600);
  return {
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      if (lstatSync(socket, { throwIfNoEntry: false })?.isSocket())
        unlinkSync(socket);
    },
  };
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const r = await runCli(process.argv.slice(2));
  process.stdout.write(r.output + "\n");
  process.exitCode = r.exitCode;
}
