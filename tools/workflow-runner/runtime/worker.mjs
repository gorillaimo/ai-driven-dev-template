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
  readFileSync,
  statfsSync,
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
} else if (mode === "integration-prepare") {
  // Only this immutable image code interprets Git objects. No repository hook,
  // configuration, checkout/filter or application command executes in this mode.
  const { execFileSync } = await import("node:child_process");
  let input = "";
  for await (const b of process.stdin) {
    input += b;
    if (Buffer.byteLength(input) > 5242880) process.exit(2);
  }
  const q = JSON.parse(input),
    L = q.limits;
  const bytes = (b) => createHash("sha256").update(b).digest("hex");
  const env = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: "/scratch",
    XDG_CONFIG_HOME: "/scratch/empty",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_NO_LAZY_FETCH: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ALLOW_PROTOCOL: "file",
    GIT_PROTOCOL_FROM_USER: "0",
    GIT_AUTHOR_NAME: "Integration",
    GIT_AUTHOR_EMAIL: "integration@example.invalid",
    GIT_COMMITTER_NAME: "Integration",
    GIT_COMMITTER_EMAIL: "integration@example.invalid",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  };
  const git = (args) =>
    execFileSync(
      "git",
      [
        "--no-replace-objects",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "protocol.allow=never",
        "-c",
        "protocol.file.allow=always",
        "-c",
        "merge.renames=false",
        "--git-dir=/scratch/repository",
        ...args,
      ],
      {
        env,
        shell: false,
        timeout: Math.min(L.command_seconds, 1800) * 1000,
        maxBuffer: Math.max(12 * 1048576, L.file_bytes + 1024),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  try {
    if (
      !/^[a-f0-9]{40}$/.test(q.main_sha) ||
      !Array.isArray(q.heads) ||
      q.heads.length > 10 ||
      q.heads.some((h) => !/^[a-f0-9]{40}$/.test(h))
    )
      throw Error();
    const boundary = {
      uid: process.getuid(),
      memory: readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim(),
      pids: readFileSync("/sys/fs/cgroup/pids.max", "utf8").trim(),
      cpu: readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim(),
      scratch_bytes:
        statfsSync("/scratch").blocks * statfsSync("/scratch").bsize,
      tmp_bytes: statfsSync("/tmp").blocks * statfsSync("/tmp").bsize,
    };
    git(["init", "--bare"]);
    git(["bundle", "verify", "/work/source.bundle"]);
    git(["bundle", "unbundle", "/work/source.bundle"]);
    let commit = q.main_sha;
    if (git(["cat-file", "-t", commit]).toString().trim() !== "commit")
      throw Error();
    let tree = git(["rev-parse", commit + "^{tree}"])
      .toString()
      .trim();
    for (const head of q.heads) {
      if (git(["cat-file", "-t", head]).toString().trim() !== "commit")
        throw Error();
      let out;
      try {
        out = git([
          "merge-tree",
          "--write-tree",
          "--no-messages",
          commit,
          head,
        ]);
      } catch (e) {
        if (e.status === 1) {
          process.stdout.write(
            JSON.stringify({ status: "conflict", boundary }) + "\n",
          );
          process.exit(0);
        }
        throw e;
      }
      tree = out.toString().trim();
      if (!/^[a-f0-9]{40}$/.test(tree)) throw Error();
      commit = git([
        "commit-tree",
        tree,
        "-p",
        commit,
        "-p",
        head,
        "-m",
        "P6 integration",
      ])
        .toString()
        .trim();
    }
    const rows = git(["ls-tree", "-r", "-z", "--full-tree", tree])
        .toString("utf8")
        .split("\0")
        .filter(Boolean),
      files = [];
    if (!rows.length || rows.length > L.source_files) throw Error();
    let total = 0;
    for (const row of rows) {
      const m =
        /^(100644|100755) blob ([a-f0-9]{40})\t([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)$/.exec(
          row,
        );
      if (
        !m ||
        m[3]
          .split("/")
          .some((x) => [".", "..", ".git", ".gitmodules"].includes(x))
      )
        throw Error();
      const size = Number(git(["cat-file", "-s", m[2]]).toString());
      total += size;
      if (size > L.file_bytes || total > L.source_bytes) throw Error();
      const b = git(["cat-file", "blob", m[2]]);
      if (
        b.length !== size ||
        b
          .subarray(0, 100)
          .toString()
          .startsWith("version https://git-lfs.github.com/spec/")
      )
        throw Error();
      files.push({
        path: m[3],
        mode: m[1],
        digest: bytes(b),
        content_base64: b.toString("base64"),
      });
    }
    process.stdout.write(
      JSON.stringify({
        status: "passed",
        tree_sha: tree,
        commit_sha: commit,
        files,
        boundary,
        git_version: git(["--version"]).toString().trim(),
      }) + "\n",
    );
  } catch {
    process.stdout.write(JSON.stringify({ status: "error" }) + "\n");
  }
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
