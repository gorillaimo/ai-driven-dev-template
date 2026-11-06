// Immutable image entrypoint. No external network, login files or host tokens.
import { createServer, request } from "node:http";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
  fstatSync,
  constants,
} from "node:fs";
const mode = process.argv[2],
  sessionRoot = existsSync("/session") ? "/session" : "/scratch",
  codexHome = sessionRoot + "/codex";
// The health command reads a bounded heartbeat without refreshing it. Host
// authority, deadlines and stop verification never rely on this hint.
const heartbeatPath = "/scratch/runner-heartbeat";
if (mode === "health") {
  let fd,
    healthy = false;
  try {
    fd = openSync(
      heartbeatPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const st = fstatSync(fd);
    if (st.isFile() && st.size <= 32 && st.nlink === 1) {
      const bytes = Buffer.alloc(32),
        count = readSync(fd, bytes, 0, bytes.length, 0),
        raw = bytes.subarray(0, count).toString("utf8"),
        age = Date.now() - Number(raw);
      healthy = /^[0-9]{13}$/.test(raw) && age >= 0 && age <= 5000;
    }
  } catch {
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  process.exit(healthy ? 0 : 1);
}
function touchHeartbeat() {
  const fd = openSync(
    heartbeatPath,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    0o600,
  );
  try {
    writeFileSync(fd, String(Date.now()));
  } finally {
    closeSync(fd);
  }
}
touchHeartbeat();
setInterval(touchHeartbeat, 1000).unref();
if (mode === "probe") {
  const child = spawn("/runtime/codex", ["--version"], {
    stdio: "inherit",
    env: {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: sessionRoot,
      CODEX_HOME: codexHome,
    },
  });
  child.on("exit", (code) => (process.exitCode = code ?? 1));
} else if (mode === "fixture") {
  await import("/fixture.mjs");
} else if (mode === "verify") {
  let input = "";
  for await (const part of process.stdin) {
    input += part;
    if (Buffer.byteLength(input) > 1048576) process.exit(2);
  }
  const q = JSON.parse(input);
  if (
    Object.keys(q).sort().join() !== "argv,executable" ||
    typeof q.executable !== "string" ||
    !/^[A-Za-z0-9_./-]{1,1024}$/.test(q.executable) ||
    !Array.isArray(q.argv) ||
    q.argv.length > 256 ||
    q.argv.some((a) => typeof a !== "string" || a.length > 2048)
  )
    process.exit(2);
  const child = spawn(q.executable, q.argv, {
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    cwd: "/work",
    env: {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: sessionRoot,
      LANG: "C.UTF-8",
    },
  });
  let bytes = 0,
    limited = false;
  const stdout = [],
    stderr = [];
  for (const [stream, parts] of [
    [child.stdout, stdout],
    [child.stderr, stderr],
  ])
    stream.on("data", (part) => {
      bytes += part.length;
      if (bytes > 512 * 1024) {
        limited = true;
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      } else parts.push(part);
    });
  child.on("error", () => process.exit(2));
  child.on("close", (exit) => {
    const out = Buffer.concat(stdout),
      err = Buffer.concat(stderr),
      count = [...out.toString("utf8").matchAll(/^# tests ([0-9]+)$/gm)].at(
        -1,
      )?.[1];
    const digest = (b) => createHash("sha256").update(b).digest("hex");
    process.stdout.write(
      JSON.stringify({
        exit_code: limited ? -1 : (exit ?? -1),
        test_count: count ? Number(count) : 0,
        command: q,
        stdout_base64: out.toString("base64"),
        stderr_base64: err.toString("base64"),
        stdout_digest: digest(out),
        stderr_digest: digest(err),
        limited,
      }) + "\n",
    );
  });
} else if (mode === "execute") {
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/responses") {
      res.writeHead(403);
      res.end();
      return;
    }
    const upstream = request(
      {
        socketPath: "/gateway/model.sock",
        method: "POST",
        path: "/v1/responses",
        headers: { "content-type": "application/json" },
      },
      (r) => {
        res.writeHead(r.statusCode, {
          "content-type": r.headers["content-type"] ?? "application/json",
        });
        r.pipe(res);
      },
    );
    let bytes = 0;
    req.on("data", (b) => {
      bytes += b.length;
      if (bytes > 5 * 1024 * 1024) {
        upstream.destroy();
        req.destroy();
      }
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const model = process.argv[3],
    context = process.argv[4],
    role = process.argv[5];
  if (
    !/^[A-Za-z0-9._-]{1,128}$/.test(model) ||
    (context !== "new" && !/^[a-zA-Z0-9-]{1,128}$/.test(context)) ||
    !["implementation", "review"].includes(role)
  )
    process.exit(2);
  mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  writeFileSync(
    codexHome + "/config.toml",
    'model_provider="runner"\nweb_search="disabled"\n[features]\nmulti_agent=false\nmulti_agent_v2=false\nmulti_agent_mode=false\nruntime_agent_instances=false\ngoals=false\napps=false\nconnectors=false\nbrowser_use=false\nhooks=false\ncodex_hooks=false\nplugin_hooks=false\nskill_mcp_dependency_install=false\n[model_providers.runner]\nname="Runner gateway"\nbase_url="http://127.0.0.1:' +
      server.address().port +
      '/v1"\nwire_api="responses"\nrequires_openai_auth=false\n',
    { mode: 0o600 },
  );
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--sandbox",
    role === "review" ? "read-only" : "workspace-write",
    "--model",
    model,
  ];
  if (context !== "new") args.push("resume", context);
  args.push("-");
  const child = spawn("/runtime/codex", args, {
    stdio: ["pipe", "inherit", "inherit"],
    env: {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: sessionRoot,
      CODEX_HOME: codexHome,
      LANG: "C.UTF-8",
      TERM: "dumb",
    },
  });
  process.stdin.pipe(child.stdin);
  child.on("exit", (code) => {
    server.close();
    process.exitCode = code ?? 1;
  });
} else process.exit(2);
