import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { profile } from "./fixture.mjs";
import { probeSandbox } from "../../tools/workflow-runner/probe.mjs";
import {
  docker,
  dockerArgs,
  inspectContainer,
  stopContainer,
} from "../../tools/workflow-runner/docker.mjs";
import { prepareWorkspace } from "../../tools/workflow-runner/workspace.mjs";
const image = process.env.WORKFLOW_RUNNER_TEST_IMAGE;
if (!/^sha256:[a-f0-9]{64}$/.test(image ?? ""))
  throw Error("fixed test image required");
test(
  "actual worker filesystem, network, credential and cgroup boundaries",
  { timeout: 30000 },
  async () => {
    const p = profile({ image });
    const r = await probeSandbox(p);
    assert.deepEqual(r.checks, {
      isolated_write: true,
      network_none: true,
      credential_separation: true,
      resource_limits: true,
    });
  },
);
test(
  "actual fixed Codex executable starts without provider credentials",
  { timeout: 15000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "runner-version-"));
    let id;
    const attempt_id = "version-" + randomUUID();
    try {
      const work = join(root, "work"),
        gate = join(root, "gate");
      mkdirSync(work);
      mkdirSync(gate);
      const p = profile({ image }),
        w = prepareWorkspace({ directory: work, profile: p, files: [] });
      const args = dockerArgs({
        attempt_id,
        role: "review",
        profile: p,
        workspace: w,
        socket_directory: gate,
      });
      args.push("probe");
      id = (await docker(args)).trim();
      const text = await docker(["start", "--attach", id], { timeout: 10000 });
      assert.match(text, /codex-cli 0\.166\.0/);
      const c = await inspectContainer(id, attempt_id);
      assert.equal(c.State.ExitCode, 0);
    } finally {
      if (id) {
        await stopContainer(id, attempt_id);
        await docker(["rm", id]);
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
);
test(
  "actual stop kills a TERM-resistant child tree and preserves unpushed files",
  { timeout: 20000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "runner-kill-"));
    let id;
    const attempt_id = "kill-" + randomUUID();
    try {
      const p = profile({ image }),
        work = join(root, "work"),
        gate = join(root, "gate");
      mkdirSync(work);
      mkdirSync(gate);
      const w = prepareWorkspace({ directory: work, profile: p, files: [] }),
        fixture = join(root, "fixture.mjs");
      writeFileSync(
        fixture,
        "import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';process.on('SIGTERM',()=>{});spawn('node',['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},100)\"],{stdio:'ignore'});writeFileSync('/work/src/unpushed','preserved');setInterval(()=>{},100);",
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
      id = (await docker(args)).trim();
      await docker(["start", id]);
      for (let i = 0; i < 50; i++) {
        const text = await docker([
          "exec",
          id,
          "test",
          "-f",
          "/work/src/unpushed",
        ]).then(
          () => true,
          () => false,
        );
        if (text) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      const r = await stopContainer(id, attempt_id);
      assert.equal(r.stopped, true);
      const c = await inspectContainer(id, attempt_id);
      assert.equal(c.State.Running, false);
      assert.equal(c.State.Pid, 0);
      const { collectArtifacts } = await import(
        "../../tools/workflow-runner/workspace.mjs"
      );
      assert.equal(
        collectArtifacts(w).files.find((f) => f.path === "src/unpushed")
          .content,
        "preserved",
      );
    } finally {
      if (id) {
        await stopContainer(id, attempt_id).catch(() => {});
        await docker(["rm", id]).catch(() => {});
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
);
test(
  "actual Codex JSONL reaches only the synthetic model gateway and returns measured usage",
  { timeout: 40000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "runner-wire-"));
    let id, server;
    const attempt_id = "wire-" + randomUUID();
    let sends = 0,
      settlements = 0;
    try {
      const { createGateway, serveGateway } = await import(
        "../../tools/workflow-runner/gateway.mjs"
      );
      const { parseCodexEvents } = await import(
        "../../tools/workflow-runner/codex.mjs"
      );
      const { hash } = await import("../../tools/workflow-runner/core.mjs");
      const p = profile({ image });
      p.model.context_tokens = 1000000;
      p.limits.max_input_tokens = 1000000;
      const work = join(root, "work"),
        gate = join(root, "gate");
      mkdirSync(work);
      mkdirSync(gate);
      const w = prepareWorkspace({
        directory: work,
        profile: p,
        files: [
          {
            path: "AGENTS.md",
            content: "Read-only synthetic protocol test. Do not run tools.",
          },
        ],
      });
      const gateway = createGateway({
        mode: "synthetic",
        profile: p,
        clock: () => p.model.pricing_expires_at.replace("07T", "06T"),
        ledger: {
          reserveUsage: async () => ({}),
          settleUsage: async () => {
            settlements++;
          },
        },
        observeAttempt: async () => ({
          active: true,
          stopped: false,
          attempt_id,
          run_id: "run-1",
          epoch: 1,
        }),
        upstream: async (body) => {
          sends++;
          const item = {
            id: "msg-synthetic",
            type: "message",
            status: "completed",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Synthetic protocol passed",
                annotations: [],
              },
            ],
          };
          const response = {
            id: "resp-synthetic",
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
              delta: "Synthetic protocol passed",
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
                (e) =>
                  "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n",
              )
              .join(""),
          };
        },
      });
      server = await serveGateway({
        socket: join(gate, "model.sock"),
        attempt_id,
        gateway: {
          async request(q, a) {
            try {
              return await gateway.request(q, a);
            } catch (e) {
              const { code } = await import(
                "../../tools/workflow-runner/core.mjs"
              );
              writeFileSync(
                "/tmp/issue50-wire-request-shape.log",
                JSON.stringify({
                  code: code(e),
                  keys: Object.keys(q.body),
                  model: q.body.model,
                  tools: q.body.tools?.map((t) => ({
                    type: t.type,
                    name: t.name,
                  })),
                  input_types: Array.isArray(q.body.input)
                    ? q.body.input.map((i) => i.type)
                    : typeof q.body.input,
                }),
                { mode: 0o600 },
              );
              throw e;
            }
          },
        },
      });
      const args = dockerArgs({
        attempt_id,
        role: "review",
        profile: p,
        workspace: w,
        socket_directory: gate,
      });
      args.push("execute", p.model.id, "new", "review");
      id = (await docker(args)).trim();
      let stdout;
      try {
        stdout = await docker(["start", "--attach", "--interactive", id], {
          timeout: 25000,
          input: "Return a short synthetic response. Do not run tools.\n",
        });
      } catch (e) {
        const c = await inspectContainer(id, attempt_id);
        if (c.State.Running) await stopContainer(id, attempt_id);
        const { spawnSync } = await import("node:child_process");
        const diagnostic = spawnSync(
          "docker",
          ["--host=unix:///var/run/docker.sock", "logs", id],
          { encoding: "utf8" },
        );
        writeFileSync(
          "/tmp/issue50-wire-diagnostic.log",
          (diagnostic.stdout ?? "") + "\n" + (diagnostic.stderr ?? ""),
          { mode: 0o600 },
        );
        throw e;
      }
      const parsed = parseCodexEvents(stdout);
      assert.equal(parsed.status, "completed");
      assert.equal(parsed.message, "Synthetic protocol passed");
      assert.ok(sends >= 1 && sends === settlements);
      assert.equal(
        gateway.receipt(attempt_id).message_digest,
        hash(parsed.message),
      );
    } finally {
      if (id) {
        await stopContainer(id, attempt_id).catch(() => {});
        await docker(["rm", id]).catch(() => {});
      }
      await server?.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
test(
  "actual resume uses the specific preserved CLI session with an inert gateway",
  { timeout: 60000 },
  async () => {
    const { probeWire } = await import("../../tools/workflow-runner/probe.mjs");
    const r = await probeWire(profile({ image }));
    assert.equal(r.resume, true);
    assert.equal(r.usage, true);
    assert.equal(r.model_gateway, true);
  },
);
