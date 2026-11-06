import {
  ADAPTER_DIGEST,
  error,
  fail,
  hash,
  pathValid,
  safe,
  within,
} from "./core.mjs";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  collectArtifacts,
  inspectWorkspace,
  prepareWorkspace,
} from "./workspace.mjs";
import { gatewayInfo, serveGateway } from "./gateway.mjs";

// adapter
const adapters = new WeakMap();
export function createSyntheticAdapter(ports) {
  if (
    !ports ||
    ["probe", "start", "observe", "stop"].some(
      (k) => typeof ports[k] !== "function",
    )
  )
    fail("adapter_invalid");
  const a = Object.freeze({});
  adapters.set(a, { ...ports, mode: "synthetic" });
  return a;
}
// Registration is module-private to trusted concrete implementations through
// the factory below. Worker JSON is never an adapter, capability or handle.
export function createDockerAdapter(options) {
  const driver = dockerDriver(options),
    a = Object.freeze({});
  adapters.set(a, driver);
  return a;
}
export function inspectAdapter(a, mode) {
  const p = adapters.get(a);
  if (!p || p.mode !== mode) fail("adapter_invalid");
  return p;
}
export function requiredCapabilities(c, p, mode) {
  return (
    safe(c) &&
    c.schema_version === 1 &&
    c.artifact_kind === "runner-capability" &&
    c.mode === mode &&
    c.adapter_id === p.adapter_id &&
    c.adapter_digest === ADAPTER_DIGEST &&
    c.image === p.image &&
    Object.keys(c.checks ?? {}).length === 11 &&
    Object.values(c.checks).every((x) => x === true)
  );
}

// docker
const absolute = (p) =>
  typeof p === "string" &&
  /^\/[A-Za-z0-9_./-]+$/.test(p) &&
  !p.split("/").some((x) => x === "." || x === "..");
export function dockerArgs(q) {
  if (
    !safe(q) ||
    !/^([a-z0-9]+-)*[a-z0-9]+$/.test(q.attempt_id) ||
    !["implementation", "review", "verification"].includes(q.role) ||
    !/^sha256:[a-f0-9]{64}$/.test(q.profile.image) ||
    !absolute(q.workspace.source) ||
    !absolute(q.socket_directory)
  )
    fail("docker_request_invalid");
  const p = q.profile,
    l = p.limits;
  if (
    !Number.isInteger(l.memory_mib) ||
    l.memory_mib < 64 ||
    l.memory_mib > 2048 ||
    ![1, 2].includes(l.cpus) ||
    !Number.isInteger(l.pids) ||
    l.pids < 16 ||
    l.pids > 128 ||
    !Number.isInteger(l.scratch_mib) ||
    l.scratch_mib < 16 ||
    l.scratch_mib > 256
  )
    fail("docker_limits_invalid");
  const a = [
    "create",
    "--interactive",
    "--name=runner-" + q.attempt_id,
    "--label=ai-workflow-runner=" + q.attempt_id,
    "--network=none",
    "--read-only",
    "--user=1000:1000",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--init",
    "--memory=" + l.memory_mib + "m",
    "--memory-swap=" + l.memory_mib + "m",
    "--cpus=" + l.cpus,
    "--pids-limit=" + l.pids,
    "--ulimit=nofile=256:256",
    "--tmpfs=/tmp:rw,nosuid,nodev,size=" +
      Math.floor(l.scratch_mib / 2) +
      "m,mode=1777",
    "--tmpfs=/scratch:rw,nosuid,nodev,size=" +
      Math.floor(l.scratch_mib / 2) +
      "m,uid=1000,gid=1000,mode=0700",
    "--log-driver=local",
    "--log-opt=max-size=10m",
    "--log-opt=max-file=1",
    "--log-opt=compress=false",
  ];
  for (const name of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
  ])
    a.push("--env", name + "=");
  a.push(
    "--mount",
    "type=bind,src=" + q.workspace.source + ",dst=/work,readonly",
  );
  for (const m of q.workspace.mounts) {
    if (
      !absolute(m.source) ||
      !pathValid(m.path) ||
      !p.write_paths.includes(m.path) ||
      m.target !== "/work/" + m.path
    )
      fail("docker_mount_invalid");
    a.push(
      "--mount",
      "type=bind,src=" +
        m.source +
        ",dst=" +
        m.target +
        (q.role === "implementation" ? "" : ",readonly"),
    );
  }
  if (q.workspace.session) {
    if (!absolute(q.workspace.session)) fail("docker_mount_invalid");
    a.push("--mount", "type=bind,src=" + q.workspace.session + ",dst=/session");
  }
  a.push(
    "--mount",
    "type=bind,src=" + q.socket_directory + ",dst=/gateway,readonly",
    p.image,
  );
  return a;
}
export async function docker(
  args,
  { timeout = 30000, maxBytes = 1048576, input, signal } = {},
) {
  return new Promise((resolve, reject) => {
    let data = [],
      bytes = 0,
      stderr = 0,
      settled = false;
    const env = { ...process.env };
    for (const k of [
      "DOCKER_HOST",
      "DOCKER_CONTEXT",
      "DOCKER_TLS",
      "DOCKER_TLS_VERIFY",
      "DOCKER_CERT_PATH",
    ])
      delete env[k];
    const child = spawn(
      "docker",
      ["--host=unix:///var/run/docker.sock", ...args],
      { env, shell: false, stdio: ["pipe", "pipe", "pipe"] },
    );
    const stop = () => {
      child.kill("SIGKILL");
      if (!settled) {
        settled = true;
        reject(error("docker_result_unknown"));
      }
    };
    const timer = setTimeout(stop, timeout);
    signal?.addEventListener("abort", stop, { once: true });
    child.on("error", stop);
    child.stdin.on("error", stop);
    child.stdout.on("data", (b) => {
      bytes += b.length;
      if (bytes > maxBytes) stop();
      else data.push(b);
    });
    child.stderr.on("data", (b) => {
      stderr += b.length;
      if (stderr > maxBytes) stop();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      if (settled) return;
      settled = true;
      if (code !== 0) reject(error("docker_command_failed"));
      else resolve(Buffer.concat(data).toString("utf8"));
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}
export async function inspectContainer(id, attempt_id) {
  if (!/^[a-f0-9]{64}$/.test(id)) fail("container_id_invalid");
  const rows = JSON.parse(await docker(["inspect", id]));
  const c = rows[0];
  if (
    !c ||
    c.Id !== id ||
    c.Config?.Labels?.["ai-workflow-runner"] !== attempt_id ||
    c.HostConfig.NetworkMode !== "none" ||
    !c.HostConfig.ReadonlyRootfs ||
    c.Config.User !== "1000:1000" ||
    c.HostConfig.Privileged ||
    c.HostConfig.PidMode === "host" ||
    !c.HostConfig.CapDrop?.includes("ALL")
  )
    fail("container_binding_invalid");
  return c;
}
export async function stopContainer(id, attempt_id) {
  let c = await inspectContainer(id, attempt_id);
  if (c.State.Running) {
    await docker(["stop", "--time", "5", id], { timeout: 10000 });
    c = await inspectContainer(id, attempt_id);
  }
  if (c.State.Running || c.State.Pid !== 0) fail("container_stop_unknown");
  const top = await docker(["top", id], { timeout: 5000 }).catch(() => null);
  if (top !== null && top.trim().split("\n").length > 1)
    fail("container_stop_unknown");
  return { stopped: true, exit_code: c.State.ExitCode };
}

// probe
const script = `import{writeFileSync,existsSync,readFileSync}from'node:fs';import{connect}from'node:net';
let denied=0;for(const p of ['/work/AGENTS.md','/etc/runner-escape','/other-issue/result']){try{writeFileSync(p,'escape');}catch{denied++;}}
writeFileSync('/work/src/result','allowed');
const network=await new Promise(resolve=>{const s=connect({host:'1.1.1.1',port:443});s.on('connect',()=>{s.destroy();resolve(false);});s.on('error',()=>resolve(true));s.setTimeout(500,()=>{s.destroy();resolve(true);});});
const memory=readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),pids=readFileSync('/sys/fs/cgroup/pids.max','utf8').trim();
const secret=!Object.keys(process.env).some(k=>/TOKEN|SECRET|API_KEY|CREDENTIAL/i.test(k))&&!existsSync('/var/run/docker.sock')&&!existsSync('/root/.aws/credentials');
process.stdout.write(JSON.stringify({denied,network,secret,memory,pids,uid:process.getuid()})+'\\n');`;
export async function probeSandbox(profile) {
  const directory = mkdtempSync(join(tmpdir(), "runner-probe-"));
  let container = null,
    attempt_id = "probe-" + randomUUID();
  const sockets = join(directory, "gateway");
  mkdirSync(sockets, { mode: 0o700 });
  try {
    const work = join(directory, "work");
    mkdirSync(work, { mode: 0o700 });
    const w = prepareWorkspace({
      directory: work,
      profile: {
        ...profile,
        read_paths: ["src", "AGENTS.md"],
        write_paths: ["src"],
        forbidden_paths: ["secrets"],
        send_paths: ["src", "AGENTS.md"],
      },
      files: [
        { path: "src/main.js", content: "Synthetic" },
        { path: "AGENTS.md", content: "Read-only rules" },
      ],
    });
    const fixture = join(directory, "fixture.mjs");
    writeFileSync(fixture, script, { mode: 0o600 });
    const p = { ...profile, write_paths: ["src"] };
    let args = dockerArgs({
      attempt_id,
      role: "implementation",
      profile: p,
      workspace: w,
      socket_directory: sockets,
    });
    args.splice(
      args.length - 1,
      0,
      "--mount",
      "type=bind,src=" + fixture + ",dst=/fixture.mjs,readonly",
    );
    args.push("fixture");
    container = (await docker(args)).trim();
    await docker(["start", "--attach", container], { timeout: 10000 });
    const c = await inspectContainer(container, attempt_id);
    if (c.State.Running || c.State.Pid !== 0 || c.State.ExitCode !== 0)
      fail("probe_process_failed");
    const raw = await docker(["logs", container]),
      v = JSON.parse(raw.trim());
    const artifact = collectArtifacts(w);
    const checks = {
      isolated_write:
        v.denied === 3 &&
        artifact.files.some(
          (f) => f.path === "src/result" && f.content === "allowed",
        ),
      network_none: v.network === true,
      credential_separation: v.secret === true && v.uid === 1000,
      resource_limits:
        v.memory === String(profile.limits.memory_mib * 1024 * 1024) &&
        v.pids === String(profile.limits.pids),
    };
    return {
      checks,
      evidence_digest: hash({
        v,
        artifact: artifact.digest,
        image: profile.image,
      }),
    };
  } finally {
    if (container) {
      await stopContainer(container, attempt_id).catch(() => {});
      await docker(["rm", container]).catch(() => {});
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

// Exercises the real CLI against an inert local model; never contacts a provider.
export async function probeWire(profile) {
  const { createGateway, serveGateway } = await import("./gateway.mjs");
  const directory = mkdtempSync(join(tmpdir(), "runner-wire-probe-")),
    gate = join(directory, "gateway"),
    work = join(directory, "work");
  mkdirSync(gate, { mode: 0o700 });
  mkdirSync(work, { mode: 0o700 });
  const p = structuredClone(profile);
  p.model.context_tokens = 1000000;
  p.limits.max_input_tokens = 1000000;
  const w = prepareWorkspace({
    directory: work,
    profile: {
      ...p,
      read_paths: ["src", "AGENTS.md"],
      write_paths: ["src"],
      send_paths: ["src", "AGENTS.md"],
      forbidden_paths: ["secrets"],
    },
    files: [
      {
        path: "AGENTS.md",
        content: "Protocol probe with inert model responses. Do not run tools.",
      },
    ],
  });
  p.write_paths = ["src"];
  let sends = 0,
    settled = 0,
    server,
    id;
  const attempt_id = "wire-" + randomUUID(),
    text = JSON.stringify({ status: "passed", findings: [] });
  const gateway = createGateway({
    mode: "synthetic",
    profile: p,
    clock: () =>
      new Date(Date.parse(p.model.pricing_expires_at) - 1000).toISOString(),
    observeAttempt: async () => ({
      active: true,
      stopped: false,
      attempt_id,
      run_id: "probe-run",
      epoch: 1,
    }),
    ledger: {
      reserveUsage: async () => ({}),
      settleUsage: async () => {
        settled++;
      },
    },
    upstream: async (body) => {
      sends++;
      const item = {
          id: "probe-message-" + sends,
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text, annotations: [] }],
        },
        response = {
          id: "probe-response-" + sends,
          object: "response",
          created_at: 1,
          status: "completed",
          model: body.model,
          output: [item],
          usage: {
            input_tokens: 20,
            output_tokens: 10,
            total_tokens: 30,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        };
      const events = [
        {
          type: "response.created",
          sequence_number: 0,
          response: { ...response, status: "in_progress", output: [] },
        },
        {
          type: "response.output_item.added",
          sequence_number: 1,
          output_index: 0,
          item: { ...item, status: "in_progress", content: [] },
        },
        {
          type: "response.content_part.added",
          sequence_number: 2,
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        },
        {
          type: "response.output_text.delta",
          sequence_number: 3,
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          delta: text,
        },
        {
          type: "response.output_item.done",
          sequence_number: 4,
          output_index: 0,
          item,
        },
        { type: "response.completed", sequence_number: 5, response },
      ];
      return {
        status: 200,
        content_type: "text/event-stream",
        body: events
          .map(
            (e) => "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n",
          )
          .join(""),
      };
    },
  });
  try {
    server = await serveGateway({
      socket: join(gate, "model.sock"),
      attempt_id,
      gateway,
    });
    async function run(context) {
      const args = dockerArgs({
        attempt_id,
        role: "review",
        profile: p,
        workspace: w,
        socket_directory: gate,
      });
      args.push("execute", p.model.id, context, "review");
      id = (await docker(args)).trim();
      try {
        const output = await docker(
            ["start", "--attach", "--interactive", id],
            {
              timeout: 20000,
              input: "Return the synthetic response without tools.\n",
            },
          ),
          parsed = parseCodexEvents(output),
          receipt = gateway.receipt(attempt_id);
        if (
          parsed.message !== text ||
          receipt?.message_digest !== hash(parsed.message)
        )
          fail("probe_gateway_mismatch");
        return parsed;
      } finally {
        await stopContainer(id, attempt_id).catch(() => {});
        await docker(["rm", id]).catch(() => {});
        id = null;
      }
    }
    const first = await run("new"),
      second = await run(first.provider_context_id);
    if (
      second.provider_context_id !== first.provider_context_id ||
      sends !== settled ||
      settled < 2
    )
      fail("probe_resume_failed");
    return {
      noninteractive: true,
      structured_output: true,
      usage: true,
      model_gateway: true,
      resume: true,
      evidence_digest: hash({
        image: p.image,
        session: first.provider_context_id,
        sends,
        settled,
      }),
    };
  } finally {
    if (id) {
      await stopContainer(id, attempt_id).catch(() => {});
      await docker(["rm", id]).catch(() => {});
    }
    await server?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

// codex
export function parseCodexEvents(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 10 * 1024 * 1024)
    fail("codex_output_limit");
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length > 10000) fail("codex_output_limit");
  let session = null,
    completed = null,
    message = null;
  for (const line of lines) {
    if (Buffer.byteLength(line) > 1048576) fail("codex_event_limit");
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      fail("codex_protocol_invalid");
    }
    if (!safe(e) || typeof e.type !== "string") fail("codex_protocol_invalid");
    if (e.type === "thread.started") {
      if (
        session ||
        typeof e.thread_id !== "string" ||
        !/^[a-zA-Z0-9-]{1,128}$/.test(e.thread_id)
      )
        fail("codex_context_invalid");
      session = e.thread_id;
    } else if (["error", "turn.failed"].includes(e.type))
      fail("codex_turn_failed");
    else if (e.type === "turn.completed") {
      if (
        completed ||
        !session ||
        !Number.isSafeInteger(e.usage?.input_tokens) ||
        !Number.isSafeInteger(e.usage?.output_tokens) ||
        e.usage.input_tokens < 0 ||
        e.usage.output_tokens < 0
      )
        fail("codex_usage_invalid");
      completed = e.usage;
    } else if (
      e.type === "item.completed" &&
      e.item?.type === "agent_message"
    ) {
      if (completed || typeof e.item.text !== "string")
        fail("codex_protocol_invalid");
      message = e.item.text;
    } else if (
      ![
        "turn.started",
        "item.started",
        "item.updated",
        "item.completed",
      ].includes(e.type)
    )
      fail("codex_event_unknown");
  }
  if (!session || !completed || message === null)
    fail("codex_terminal_missing");
  return {
    status: "completed",
    provider_context_id: session,
    usage: completed,
    message,
  };
}

// docker-adapter
const policy = JSON.parse(
  readFileSync(new URL("./adapters.lock.json", import.meta.url), "utf8"),
);
const handles = new WeakMap(),
  resumeTokens = new WeakMap();
export function dockerDriver({
  profile,
  mode,
  gateway,
  clock = () => new Date().toISOString(),
}) {
  if (
    !["synthetic", "production"].includes(mode) ||
    gatewayInfo(gateway)?.mode !== mode ||
    gatewayInfo(gateway)?.profile_digest !== hash(profile)
  )
    fail("docker_adapter_invalid");
  const p = structuredClone(profile);
  let observed = null;
  const get = (h) => {
      const r = handles.get(h);
      if (!r || r.owner !== owner) fail("worker_handle_invalid");
      return r;
    },
    owner = Object.freeze({});
  return {
    kind: "runner-docker",
    mode,
    async probe() {
      const version = await probeVersion(p),
        sandbox = await probeSandbox(p),
        wire = await probeWire(p),
        stop = await probeStopTree(p);
      const root = JSON.parse(await docker(["image", "inspect", p.image]));
      if (root[0]?.Id !== p.image) fail("image_changed");
      const checks = {
        version: version.version && p.adapter_digest === ADAPTER_DIGEST,
        noninteractive: wire.noninteractive,
        structured_output: wire.structured_output,
        ...sandbox.checks,
        stop_tree: stop.stop_tree,
        resume: wire.resume,
        usage: wire.usage,
        model_gateway: wire.model_gateway,
      };
      // General untrusted implementation still requires independently verified
      // write-volume quotas and live adoption. The inert probes cannot certify it.
      if (mode === "production") {
        checks.resource_limits = false;
        checks.usage = false;
      }
      observed = {
        schema_version: 1,
        artifact_kind: "runner-capability",
        adapter_id: p.adapter_id,
        adapter_digest: p.adapter_digest,
        image: p.image,
        mode,
        observed_at: clock(),
        checks,
        evidence_digest: hash({
          sandbox,
          wire,
          stop,
          adoption: policy.adapters[0].production_adopted,
        }),
      };
      return structuredClone(observed);
    },
    async start(q) {
      if (
        !safe(q.attempt) ||
        q.attempt.profile_digest !== hash(p) ||
        !["implementation", "review", "verification"].includes(q.role) ||
        q.role !== q.attempt.role ||
        typeof q.onCreated !== "function"
      )
        fail("adapter_request_invalid");
      if (mode === "production" && !policy.adapters[0].production_adopted)
        fail("adapter_not_adopted");
      const workspace = inspectWorkspace(q.workspace),
        gate = mkdtempSync("/tmp/wrg-");
      let server = null,
        id = null;
      try {
        if (q.role !== "verification")
          server = await serveGateway({
            socket: join(gate, "model.sock"),
            attempt_id: q.attempt.attempt_id,
            gateway,
          });
        const args = dockerArgs({
          attempt_id: q.attempt.attempt_id,
          role: q.role,
          profile: { ...p, write_paths: workspace.profile.write_paths },
          workspace: q.workspace,
          socket_directory: gate,
        });
        let input;
        if (q.role === "verification") {
          if (
            !safe(q.command) ||
            typeof q.command.executable !== "string" ||
            !Array.isArray(q.command.argv)
          )
            fail("verification_command_invalid");
          args.push("verify");
          input = JSON.stringify(q.command);
        } else {
          if (
            typeof q.prompt !== "string" ||
            Buffer.byteLength(q.prompt) > 5 * 1024 * 1024
          )
            fail("prompt_invalid");
          let context = "new";
          if (q.resume_token) {
            const proof = resumeTokens.get(q.resume_token);
            if (
              !proof ||
              proof.owner !== owner ||
              q.role !== "implementation" ||
              proof.record.claim_id !== q.attempt.claim_id ||
              proof.record.run_id !== q.attempt.run_id ||
              proof.directory !== workspace.directory ||
              q.attempt.generation < proof.record.generation
            )
              fail("resume_binding_invalid");
            context = proof.context;
          }
          args.push("execute", p.model.id, context, q.role);
          input = q.prompt;
        }
        if (q.signal?.aborted) fail("startup_cancelled");
        id = (await docker(args)).trim();
        await q.onCreated(id);
        if (q.signal?.aborted) fail("startup_cancelled");
        const completion = docker(["start", "--attach", "--interactive", id], {
          timeout: p.limits.call_seconds * 1000,
          maxBytes: 10 * 1024 * 1024,
          input,
        }).then(
          (stdout) => ({ stdout, error: false }),
          () => ({ stdout: null, error: true }),
        );
        const h = Object.freeze({});
        handles.set(h, {
          owner,
          id,
          attempt: q.attempt,
          workspace: q.workspace,
          server,
          gate,
          completion,
          role: q.role,
          context_id: q.context_id,
        });
        return h;
      } catch (e) {
        if (id) await stopContainer(id, q.attempt.attempt_id).catch(() => {});
        await server?.close();
        rmSync(gate, { recursive: true, force: true });
        throw e;
      }
    },
    async observe(h) {
      const r = get(h),
        completed = await r.completion,
        c = await inspectContainer(r.id, r.attempt.attempt_id);
      if (c.State.Running || c.State.Pid !== 0)
        return {
          status: "unknown",
          stopped: false,
          context_id: r.context_id,
          output: {},
        };
      const stdout =
        completed.stdout ??
        (await docker(["logs", r.id], { maxBytes: 10 * 1024 * 1024 }).catch(
          () => null,
        ));
      await r.server?.close();
      rmSync(r.gate, { recursive: true, force: true });
      if (completed.error || c.State.ExitCode !== 0 || stdout === null)
        return {
          status: "failed",
          stopped: true,
          context_id: r.context_id,
          output: {
            exit_code: c.State.ExitCode,
            log_digest: hash(stdout ?? ""),
          },
        };
      if (r.role === "verification") {
        let result;
        try {
          result = JSON.parse(stdout.trim());
        } catch {
          fail("verification_protocol_invalid");
        }
        if (
          !safe(result) ||
          !Number.isInteger(result.exit_code) ||
          !Number.isInteger(result.test_count)
        )
          fail("verification_protocol_invalid");
        return {
          status: result.exit_code === 0 ? "completed" : "failed",
          stopped: true,
          context_id: r.context_id,
          output: result,
        };
      }
      const parsed = parseCodexEvents(stdout),
        receipt = gateway.receipt(r.attempt.attempt_id);
      if (!receipt || receipt.message_digest !== hash(parsed.message))
        fail("model_response_unbound");
      writeFileSync(
        join(
          inspectWorkspace(r.workspace).directory,
          "provider-session-" + r.attempt.attempt_id + ".json",
        ),
        JSON.stringify({
          runner_context_id: r.context_id,
          provider_context_id: parsed.provider_context_id,
          claim_id: r.attempt.claim_id,
          worker_id: r.attempt.worker_id,
          generation: r.attempt.generation,
          run_id: r.attempt.run_id,
          profile_digest: hash(p),
        }),
        { mode: 0o600, flag: "wx" },
      );
      return {
        status: "completed",
        stopped: true,
        context_id: r.context_id,
        output: { ...parsed, provider_receipt: receipt },
      };
    },
    async stop(h) {
      const r = get(h);
      const stopped = await stopContainer(r.id, r.attempt.attempt_id);
      await r.server?.close();
      rmSync(r.gate, { recursive: true, force: true });
      return stopped;
    },
    async resume(q) {
      if (!resumeTokens.has(q.resume_token))
        fail("resume_requires_reconciliation");
      return this.start(q);
    },
    usage(h) {
      const r = get(h);
      return gateway.receipt(r.attempt.attempt_id);
    },
    async recoverStop(record, { workspace } = {}) {
      if (!safe(record) || !record.container_id)
        fail("recovery_container_unknown");
      const state = await inspectContainer(
        record.container_id,
        record.attempt_id,
      );
      if (state.Image !== p.image) fail("recovery_image_changed");
      const result = await stopContainer(
        record.container_id,
        record.attempt_id,
      );
      let resume_token = null;
      if (record.role === "implementation" && workspace) {
        const w = inspectWorkspace(workspace);
        let meta;
        try {
          meta = JSON.parse(
            readFileSync(
              join(
                w.directory,
                "provider-session-" + record.attempt_id + ".json",
              ),
              "utf8",
            ),
          );
        } catch {}
        if (
          meta &&
          safe(meta) &&
          meta.claim_id === record.claim_id &&
          meta.run_id === record.run_id &&
          meta.worker_id === record.worker_id &&
          meta.generation === record.generation &&
          meta.profile_digest === hash(p) &&
          /^[a-zA-Z0-9-]{1,128}$/.test(meta.provider_context_id)
        ) {
          resume_token = Object.freeze({});
          resumeTokens.set(resume_token, {
            owner,
            record: structuredClone(record),
            directory: w.directory,
            context: meta.provider_context_id,
          });
        }
      }
      return { ...result, resume_token };
    },
  };
}

export async function probeStopTree(profile) {
  const root = mkdtempSync(join(tmpdir(), "runner-stop-probe-"));
  let container = null;
  const attempt_id = "stop-" + randomUUID();
  try {
    const work = join(root, "work"),
      gate = join(root, "gate");
    mkdirSync(work, { mode: 0o700 });
    mkdirSync(gate, { mode: 0o700 });
    const p = {
        ...structuredClone(profile),
        read_paths: ["src"],
        write_paths: ["src"],
        send_paths: ["src"],
        forbidden_paths: ["secrets"],
      },
      w = prepareWorkspace({ directory: work, profile: p, files: [] }),
      fixture = join(root, "fixture.mjs");
    writeFileSync(
      fixture,
      "import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';process.on('SIGTERM',()=>{});spawn('node',['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},100)\"],{stdio:'ignore'});writeFileSync('/work/src/unpushed','preserved');setInterval(()=>{},100);",
      { mode: 0o600 },
    );
    const args = dockerArgs({
      attempt_id,
      role: "implementation",
      profile: p,
      workspace: w,
      socket_directory: gate,
    });
    args.splice(
      args.length - 1,
      0,
      "--mount",
      "type=bind,src=" + fixture + ",dst=/fixture.mjs,readonly",
    );
    args.push("fixture");
    container = (await docker(args)).trim();
    await docker(["start", container]);
    let written = false;
    for (let i = 0; i < 50; i++) {
      written = await docker([
        "exec",
        container,
        "test",
        "-f",
        "/work/src/unpushed",
      ]).then(
        () => true,
        () => false,
      );
      if (written) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    if (!written) fail("stop_probe_not_started");
    const stopped = await stopContainer(container, attempt_id),
      artifact = collectArtifacts(w);
    if (
      !stopped.stopped ||
      !artifact.files.some(
        (f) => f.path === "src/unpushed" && f.content === "preserved",
      )
    )
      fail("stop_probe_failed");
    return {
      stop_tree: true,
      evidence_digest: hash({ image: p.image, artifact: artifact.digest }),
    };
  } finally {
    if (container) {
      await stopContainer(container, attempt_id).catch(() => {});
      await docker(["rm", container]).catch(() => {});
    }
    rmSync(root, { recursive: true, force: true });
  }
}

export async function probeVersion(profile) {
  const root = mkdtempSync(join(tmpdir(), "runner-version-probe-")),
    attempt_id = "version-" + randomUUID();
  let id;
  try {
    const work = join(root, "work"),
      gate = join(root, "gate");
    mkdirSync(work, { mode: 0o700 });
    mkdirSync(gate, { mode: 0o700 });
    const w = prepareWorkspace({ directory: work, profile, files: [] }),
      args = dockerArgs({
        attempt_id,
        role: "review",
        profile,
        workspace: w,
        socket_directory: gate,
      });
    args.push("probe");
    id = (await docker(args)).trim();
    const text = await docker(["start", "--attach", id], { timeout: 10000 });
    const c = await inspectContainer(id, attempt_id);
    if (c.State.ExitCode !== 0 || text.trim() !== "codex-cli 0.166.0")
      fail("adapter_version_mismatch");
    return {
      version: true,
      evidence_digest: hash({ text, image: profile.image }),
    };
  } finally {
    if (id) {
      await stopContainer(id, attempt_id).catch(() => {});
      await docker(["rm", id]).catch(() => {});
    }
    rmSync(root, { recursive: true, force: true });
  }
}
