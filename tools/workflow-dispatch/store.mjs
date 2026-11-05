import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { validateProjectV2 } from "./check.mjs";
import { valid } from "./schema.mjs";
import { safe, fail, makeError } from "./core.mjs";
const MAX = 1024 * 1024,
  sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
export async function openStore({
  directory,
  configuration,
  python = "python3",
}) {
  const checked = validateProjectV2(configuration);
  if (
    checked.status !== "passed" ||
    typeof directory !== "string" ||
    directory !== resolve(directory) ||
    python !== "python3"
  )
    fail("store_configuration_invalid");
  const { project: p, team: t } = configuration;
  const cfg = {
    project_id: p.project_id,
    configuration_digest: checked.configuration_digest,
    owners: Object.fromEntries(
      t.members.map((m) => [m.github_login, m.max_concurrent_issues]),
    ),
    active_owners: t.members
      .filter((m) => m.active && m.roles.includes("developer"))
      .map((m) => m.github_login),
    areas: p.areas,
    parallel_limit: p.dispatcher.max_parallel_issues,
    run_limit: p.dispatcher.max_run_issues,
  };
  const child = spawn(
    python,
    [
      fileURLToPath(new URL("./ledger_server.py", import.meta.url)),
      directory,
      sourceRoot,
    ],
    {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        LANG: "C.UTF-8",
        PYTHONNOUSERSITE: "1",
        PYTHONDONTWRITEBYTECODE: "1",
      },
    },
  );
  let next = 0,
    buffer = "",
    closed = false,
    dead = false,
    stderrBytes = 0;
  const pending = new Map();
  const stop = () => {
    if (dead) return;
    dead = true;
    for (const q of pending.values()) {
      clearTimeout(q.timer);
      q.reject(makeError("ledger_unavailable"));
    }
    pending.clear();
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 500);
    timer.unref();
  };
  child.on("error", stop);
  child.on("exit", () => {
    closed = true;
    stop();
  });
  child.stdin.on("error", stop);
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes > MAX) stop();
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    if (Buffer.byteLength(buffer) > MAX * 2) {
      stop();
      return;
    }
    let pos;
    while ((pos = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, pos);
      buffer = buffer.slice(pos + 1);
      try {
        if (Buffer.byteLength(line) > MAX) throw Error();
        const row = JSON.parse(line),
          q = pending.get(row.id);
        if (
          !safe(row) ||
          !q ||
          typeof row.ok !== "boolean" ||
          Object.keys(row).sort().join() !==
            (row.ok ? "id,ok,value" : "error,id,ok")
        )
          throw Error();
        pending.delete(row.id);
        clearTimeout(q.timer);
        if (row.ok) q.resolve(row.value);
        else
          q.reject(
            makeError(
              /^[a-z0-9_]{1,128}$/.test(row.error)
                ? row.error
                : "ledger_unavailable",
            ),
          );
      } catch {
        stop();
      }
    }
  });
  function rpc(command, data, id = ++next) {
    if (dead || closed || !safe(data))
      return Promise.reject(makeError("ledger_unavailable"));
    if (pending.size >= 64) return Promise.reject(makeError("ledger_busy"));
    const raw = JSON.stringify({ id, command, data }) + "\n";
    if (Buffer.byteLength(raw) > MAX)
      return Promise.reject(makeError("frame_limit"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stop();
        reject(makeError("ledger_timeout_unknown"));
      }, 6000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(raw);
    });
  }
  try {
    await rpc("initialize", cfg, 0);
  } catch {
    stop();
    throw makeError("ledger_unavailable");
  }
  async function view() {
    const r = await rpc("view", {});
    if (!valid("urn:ai-workflow:dispatch:v1:ledger-view", r)) {
      stop();
      fail("ledger_corrupt");
    }
    return r;
  }
  return {
    view,
    reserve: (q) => rpc("reserve", q),
    bindAuthority: (q) => rpc("bind_authority", q),
    operations: (q) => rpc("operations", q),
    migrate: async (q) => {
      if (
        !safe(q) ||
        !Array.isArray(q.claims) ||
        q.claims.some(
          (c) => !valid("urn:ai-workflow:dispatch:v1:common#/$defs/claim", c),
        )
      )
        fail("migration_invalid");
      return rpc("migrate", q);
    },
    transition: (q) => rpc("transition", q),
    beginOperation: (q) => rpc("begin_operation", q),
    finishOperation: (q) => rpc("finish_operation", q),
    stopRun: (q) => rpc("stop_run", q),
    reconcile: (q) => rpc("reconcile", q),
    async close() {
      if (closed) return;
      try {
        await rpc("close", {});
      } finally {
        child.stdin.end();
        await new Promise((resolve) => {
          if (closed) return resolve();
          const timer = setTimeout(() => {
            stop();
            resolve();
          }, 1000);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    },
  };
}
