import test from "node:test";
import assert from "node:assert/strict";
import { fork, spawn } from "node:child_process";
import { mkdtempSync, chmodSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fixture, time, hash } from "./fixture.mjs";
import { validateProjectV2 } from "../../tools/workflow-dispatch/check.mjs";
import { planBatch } from "../../tools/workflow-dispatch/plan.mjs";
import { openStore } from "../../tools/workflow-dispatch/store.mjs";
const environment = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  LANG: "C.UTF-8",
  PYTHONNOUSERSITE: "1",
  PYTHONDONTWRITEBYTECODE: "1",
};
const delay = (n) => new Promise((resolve) => setTimeout(resolve, n));
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "dispatch-process-"));
  chmodSync(directory, 0o700);
  const f = fixture(),
    task = planBatch(f).selected[0];
  return {
    directory,
    f,
    reservation: {
      operation_id: "race-1",
      input_digest: hash(task),
      run_id: f.grant.run_id,
      claim_id: "race-claim",
      worker_id: "race-worker",
      task,
      run_limit: 10,
      execution_limit: 2,
      expires_at: f.grant.expires_at,
      now: time,
    },
    migration: { manifest_digest: "d".repeat(64), claims: [], now: time },
    clean() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
async function rawStore(s) {
  const child = spawn(
    "python3",
    [
      fileURLToPath(
        new URL(
          "../../tools/workflow-dispatch/ledger_server.py",
          import.meta.url,
        ),
      ),
      s.directory,
      fileURLToPath(new URL("../../", import.meta.url)),
    ],
    { env: environment, stdio: ["pipe", "pipe", "pipe"] },
  );
  let id = 0;
  const pending = new Map();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const row = JSON.parse(line),
      p = pending.get(row.id);
    if (p) {
      pending.delete(row.id);
      row.ok ? p.resolve(row.value) : p.reject(new Error("backend rejected"));
    }
  });
  child.on("exit", () => {
    for (const p of pending.values()) p.reject(new Error("backend stopped"));
    pending.clear();
  });
  child.stderr.resume();
  function rpc(command, data, number = ++id) {
    return new Promise((resolve, reject) => {
      pending.set(number, { resolve, reject });
      child.stdin.write(JSON.stringify({ id: number, command, data }) + "\n");
    });
  }
  const p = s.f.project;
  await rpc(
    "initialize",
    {
      project_id: p.project_id,
      configuration_digest: validateProjectV2(s.f).configuration_digest,
      owners: Object.fromEntries(
        s.f.team.members.map((m) => [m.github_login, m.max_concurrent_issues]),
      ),
      active_owners: s.f.team.members
        .filter((m) => m.active && m.roles.includes("developer"))
        .map((m) => m.github_login),
      areas: p.areas,
      parallel_limit: 2,
      run_limit: 10,
    },
    0,
  );
  return {
    child,
    rpc,
    async kill() {
      const done = once(child, "exit");
      child.kill("SIGKILL");
      await done;
      lines.close();
    },
  };
}
test(
  "two real Node/Python writers racing for one ledger produce exactly one reservation",
  { timeout: 15000 },
  async () => {
    const s = setup(),
      children = [];
    try {
      const make = () => {
        const child = fork(new URL("./racer.mjs", import.meta.url), [], {
          env: environment,
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        });
        children.push(child);
        child.stderr.resume();
        const barrier = new Promise((resolve) =>
          child.once("message", resolve),
        );
        return { child, barrier };
      };
      const peers = [make(), make()];
      await Promise.all(peers.map((p) => p.barrier));
      const results = await Promise.all(
        peers.map(
          (p) =>
            new Promise((resolve) => {
              p.child.once("message", resolve);
              p.child.send({
                options: { directory: s.directory, configuration: s.f },
                migration: s.migration,
                reservation: s.reservation,
              });
            }),
        ),
      );
      assert.equal(results.filter((r) => r.status === "reserved").length, 1);
      const exits = children.map((c) => once(c, "exit"));
      children.forEach((c) => {
        if (c.connected) c.send({ close: true });
      });
      await Promise.all(exits);
      const store = await openStore({
        directory: s.directory,
        configuration: s.f,
      });
      try {
        const v = await store.view();
        assert.equal(v.claims.length, 1);
        assert.equal(v.status, "recovery_required");
      } finally {
        await store.close();
      }
    } finally {
      children.forEach((c) => c.kill("SIGKILL"));
      s.clean();
    }
  },
);
test(
  "SIGKILL after writes but before COMMIT rolls back claim, slot and area together",
  { timeout: 15000 },
  async () => {
    const s = setup();
    let raw, reader, store;
    try {
      raw = await rawStore(s);
      await raw.rpc("migrate", s.migration);
      const script =
        "import sqlite3,sys\nc=sqlite3.connect(sys.argv[1],isolation_level=None)\nc.execute('BEGIN')\nc.execute('SELECT * FROM meta').fetchall()\nprint('locked',flush=True)\nsys.stdin.readline()\nc.rollback()\nc.close()";
      reader = spawn(
        "python3",
        ["-c", script, join(s.directory, "ledger.sqlite")],
        { env: environment, stdio: ["pipe", "pipe", "pipe"] },
      );
      reader.stderr.resume();
      await once(reader.stdout, "data");
      const outstanding = raw.rpc("reserve", s.reservation).catch(() => null);
      for (
        let i = 0;
        i < 100 && !existsSync(join(s.directory, "ledger.sqlite-journal"));
        i++
      )
        await delay(5);
      assert.ok(existsSync(join(s.directory, "ledger.sqlite-journal")));
      await raw.kill();
      await outstanding;
      const done = once(reader, "exit");
      reader.stdin.end("\n");
      await done;
      store = await openStore({ directory: s.directory, configuration: s.f });
      const v = await store.view();
      assert.deepEqual(v.claims, []);
      assert.deepEqual(v.runs, []);
      assert.equal(v.history.claims, 0);
      assert.equal(v.status, "ready");
    } finally {
      await store?.close();
      if (raw && raw.child.exitCode === null && raw.child.signalCode === null)
        await raw.kill();
      reader?.kill("SIGKILL");
      s.clean();
    }
  },
);
test(
  "SIGKILL after durable reservation and outbox preserves the fence and uncertainty",
  { timeout: 15000 },
  async () => {
    const s = setup();
    let raw, store;
    try {
      raw = await rawStore(s);
      await raw.rpc("migrate", s.migration);
      const c = await raw.rpc("reserve", s.reservation);
      await raw.rpc("begin_operation", {
        claim_id: c.claim_id,
        worker_id: c.worker_id,
        generation: c.generation,
        operation_id: "external-unknown",
        input_digest: "e".repeat(64),
        kind: "create_branch",
        actor_id: 99,
        now: time,
      });
      await raw.kill();
      store = await openStore({ directory: s.directory, configuration: s.f });
      const v = await store.view();
      assert.equal(v.claims.length, 1);
      assert.equal(v.pending_operations.length, 1);
      assert.equal(v.status, "recovery_required");
      assert.ok(v.generation > c.generation);
      await assert.rejects(
        store.transition({
          claim_id: c.claim_id,
          worker_id: c.worker_id,
          generation: c.generation,
          status: "released",
          head_sha: c.head_sha,
          execution_stopped: true,
          now: time,
        }),
      );
    } finally {
      await store?.close();
      if (raw && raw.child.exitCode === null && raw.child.signalCode === null)
        await raw.kill();
      s.clean();
    }
  },
);
