import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { profile } from "./fixture.mjs";
import { probeSandbox } from "../../tools/workflow-runner/adapter.mjs";
import {
  docker,
  dockerArgs,
  inspectContainer,
  stopContainer,
} from "../../tools/workflow-runner/adapter.mjs";
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
        "../../tools/workflow-runner/adapter.mjs"
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
        gateway,
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
      const stdout = await docker(["start", "--attach", "--interactive", id], {
        timeout: 25000,
        input: "Return a short synthetic response. Do not run tools.\n",
      });
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
    const { probeWire } = await import(
      "../../tools/workflow-runner/adapter.mjs"
    );
    const r = await probeWire(profile({ image }));
    assert.equal(r.resume, true);
    assert.equal(r.usage, true);
    assert.equal(r.model_gateway, true);
  },
);
test(
  "actual verification runs the pinned command and records test count and raw log digests",
  { timeout: 15000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "runner-verify-"));
    let id;
    const attempt_id = "verify-" + randomUUID();
    try {
      const p = profile({ image }),
        work = join(root, "work"),
        gate = join(root, "gate");
      mkdirSync(work);
      mkdirSync(gate);
      const w = prepareWorkspace({
        directory: work,
        profile: p,
        files: [
          {
            path: "tests/main.test.js",
            content:
              "const test=require('node:test');const assert=require('node:assert/strict');test('actual assertion',()=>assert.equal(2+2,4));",
          },
        ],
      });
      const args = dockerArgs({
        attempt_id,
        role: "verification",
        profile: p,
        workspace: w,
        socket_directory: gate,
      });
      args.push("verify");
      id = (await docker(args)).trim();
      const raw = await docker(["start", "--attach", "--interactive", id], {
          timeout: 10000,
          input: JSON.stringify({
            executable: "node",
            argv: ["--test", "tests/main.test.js"],
          }),
        }),
        r = JSON.parse(raw);
      assert.equal(r.exit_code, 0);
      assert.equal(r.test_count, 1);
      assert.match(
        Buffer.from(r.stdout_base64, "base64").toString(),
        /actual assertion/,
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
  "P4 claim, real isolated CLI, actual test command and a separate review reach P1 through inert responses",
  { timeout: 90000 },
  async () => {
    const { controllerFixture } = await import(
      "../workflow-dispatch/controller-fixture.mjs"
    );
    const {
      fixture: execution,
      rebind,
      ref,
      source,
    } = await import("../workflow-execution/fixture.mjs");
    const { time: dispatchTime } = await import(
      "../workflow-dispatch/fixture.mjs"
    );
    const { hash } = await import("../../tools/workflow-runner/core.mjs");
    const { createGateway } = await import(
      "../../tools/workflow-runner/gateway.mjs"
    );
    const { createDockerAdapter } = await import(
      "../../tools/workflow-runner/adapter.mjs"
    );
    const { openSupervisor } = await import(
      "../../tools/workflow-runner/supervisor.mjs"
    );
    const { createRunnerAuthority } = await import(
      "../../tools/workflow-runner/authority.mjs"
    );
    const { signedRequest } = await import("./fixture.mjs");
    const s = await controllerFixture(),
      directory = mkdtempSync(join(tmpdir(), "runner-connected-"));
    let supervisor,
      reviewRecord,
      verificationRecord,
      sends = 0;
    try {
      const r = await s.dispatcher.reserve(s.f);
      assert.equal(r.reservations.length, 1, JSON.stringify(r));
      const { claim, handle } = r.reservations[0];
      for (const kind of ["create_branch", "append_claim"])
        assert.equal(
          (await s.dispatcher.execute(handle, s.operation(claim, kind))).status,
          "confirmed",
        );
      const p = profile({
        image,
        execution_profile_digest: hash(s.f.profile),
        policy_digest: hash(s.g.policy),
        write_paths: ["src"],
      });
      p.model.context_tokens = 1000000;
      p.limits.max_input_tokens = 1000000;
      p.limits.cost_microusd = 1000000000;
      const request = signedRequest(p, "continue", {
        issued_at: dispatchTime,
        expires_at: "2026-11-04T00:11:00Z",
        source_updated_at: dispatchTime,
      });
      request.source.updated_at = dispatchTime;
      request.source.observed_at = dispatchTime;
      const authority = createRunnerAuthority({
        mode: "synthetic",
        keys: [request.key],
        readSource: async () => request.source,
        clock: () => dispatchTime,
      });
      const gateway = createGateway({
        mode: "synthetic",
        profile: p,
        clock: () => dispatchTime,
        ledger: {
          reserveUsage: (q) => supervisor.modelPorts().ledger.reserveUsage(q),
          settleUsage: (q) => supervisor.modelPorts().ledger.settleUsage(q),
        },
        observeAttempt: (q) => supervisor.modelPorts().observeAttempt(q),
        upstream: async (body) => {
          sends++;
          const text = reviewRecord
              ? JSON.stringify(reviewRecord)
              : "Synthetic implementation completed",
            item = {
              id: "msg-" + sends,
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text, annotations: [] }],
            },
            response = {
              id: "resp-" + sends,
              object: "response",
              created_at: 1793923800,
              status: "completed",
              model: body.model,
              output: [item],
              usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
            };
          return {
            status: 200,
            content_type: "text/event-stream",
            body: [
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
            ]
              .map(
                (e) =>
                  "event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n",
              )
              .join(""),
          };
        },
      });
      const input = execution();
      input.profile = structuredClone(s.f.profile);
      input.grant = structuredClone(s.f.grant);
      input.context.contract_digest = input.grant.selected[0].contract_digest;
      input.context.design_digest = input.grant.selected[0].design_digest;
      for (const v of [...input.verifications, ...input.reviews]) {
        v.started_at = dispatchTime;
        v.finished_at = dispatchTime;
      }
      rebind(input);
      const adapter = createDockerAdapter({
        profile: p,
        mode: "synthetic",
        gateway,
        clock: () => dispatchTime,
      });
      supervisor = await openSupervisor({
        directory,
        profile: p,
        authority,
        adapter,
        dispatcher: s.dispatcher,
        mode: "synthetic",
        clock: () => dispatchTime,
        prepareTask: async ({ attempt, history, role }) => {
          const work = join(directory, attempt.attempt_id);
          mkdirSync(work, { mode: 0o700 });
          if (role === "review") {
            const implementation = history.find(
                (a) => a.role === "implementation",
              ),
              verification = history.find((a) => a.role === "verification"),
              observed = JSON.parse(
                readFileSync(
                  join(directory, verification.attempt_id + ".artifact.json"),
                  "utf8",
                ),
              ).execution.result.output;
            verificationRecord = {
              ...input.verifications[0],
              exit_code: observed.exit_code,
              test_count: observed.test_count,
              log_refs: [
                {
                  ...source("actual-verification"),
                  digest: verification.artifact_digest,
                },
              ],
            };
            input.verifications = [verificationRecord];
            rebind(input);
            reviewRecord = {
              ...input.reviews[0],
              implementer: {
                ...input.reviews[0].implementer,
                context_id: implementation.context_id,
              },
              reviewer: {
                ...input.reviews[0].reviewer,
                context_id: attempt.context_id,
              },
              verification_refs: [ref(verificationRecord)],
            };
          }
          return {
            workspace: prepareWorkspace({
              directory: work,
              profile: p,
              files: [
                { path: "src/main.js", content: "export const value=1;" },
                {
                  path: "tests/main.test.mjs",
                  content:
                    "import test from 'node:test';import assert from 'node:assert/strict';test('synthetic',()=>assert.equal(1,1));",
                },
              ],
            }),
            prompt:
              "Synthetic protocol test. Do not use tools. Return the requested JSON review or implementation result.",
            execution_profile: input.profile,
            command_id: "unit",
          };
        },
        evaluate: async ({ review }) => {
          input.reviews = [
            {
              ...JSON.parse(review.result.message),
              evidence_refs: [
                { ...source("actual-review"), digest: review.artifact.digest },
              ],
            },
          ];
          rebind(input);
          return { input, repairable: false, workflow_status: "running" };
        },
      });
      const result = await supervisor.accept(request.envelope, [
        { claim_id: claim.claim_id, handle },
      ]);
      assert.equal(result.status, "passed", JSON.stringify(result));
      assert.equal(sends, 2);
      assert.equal(result.attempts.length, 3);
      assert.equal(new Set(result.attempts.map((a) => a.context_id)).size, 3);
      const view = await supervisor.inspect();
      assert.equal(view.usage.length, 2);
      assert.ok(view.usage.every((u) => u.status === "confirmed"));
      assert.ok(result.not_evaluated.includes("live_provider"));
    } finally {
      const view = await supervisor?.inspect();
      await supervisor?.close();
      for (const a of view?.attempts ?? [])
        if (a.container_id) {
          await stopContainer(a.container_id, a.attempt_id).catch(() => {});
          await docker(["rm", a.container_id]).catch(() => {});
        }
      await s.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
