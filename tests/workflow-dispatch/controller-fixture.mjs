import { mkdtempSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, bind, hash, time, migrationInput } from "./fixture.mjs";
import { source } from "../workflow-execution/fixture.mjs";
import { fixture as github, fakeApi } from "../workflow-github/fixture.mjs";
import {
  createDispatcherAuthority,
  openDispatcher,
} from "../../tools/workflow-dispatch/controller.mjs";
export async function controllerFixture(options = {}) {
  const f = fixture(),
    g = github(),
    api = fakeApi(),
    directory = mkdtempSync(join(tmpdir(), "dispatch-controller-"));
  chmodSync(directory, 0o700);
  f.project.repository = g.policy.repository;
  f.project.coordinators.assignments[0].github_login = "gorillaimo";
  for (const a of f.project.areas)
    if (a.integration_owner) a.integration_owner = "gorillaimo";
  f.project.areas[0].paths = ["src"];
  f.team.members[0].github_login = "gorillaimo";
  f.deliveryPlan.features.splice(1);
  f.deliveryPlan.features[0].issue_refs[0].issue_ref =
    "https://github.com/example/synthetic/issues/1";
  f.profile = g.profile;
  f.grant = g.grant;
  f.snapshot = g.snapshot;
  f.issue_facts.splice(1);
  bind(f);
  let dispatcher;
  const evidence = ({ binding_digest }) => ({
    binding_digest,
    human_owner: "gorillaimo",
    observed_at: time,
    evidence_refs: [source("synthetic-proof")],
  });
  const authority = createDispatcherAuthority({
    mode: "synthetic",
    observe: async () => structuredClone(f),
    authorizeMigration: async (c) => evidence(c),
    authorizeTask: async (c) => {
      const input = structuredClone(g.input);
      options.changeAuthorization?.(input);
      return {
        input,
        issuerKeys: g.issuerKeys,
        observe: async (q) => {
          await options.observe?.(q, dispatcher);
          return structuredClone(g.state);
        },
      };
    },
    workerEvidence: async (c) => ({
      ...evidence(c),
      worker_stopped: true,
      release_confirmed: c.transition.status === "released",
    }),
    authorizeRecovery: async (c) => ({
      ...evidence(c),
      workers_stopped: true,
      unpublished_reconciled: true,
    }),
  });
  const transport = {
    identity: async () => structuredClone(g.state.credential),
    async request(q) {
      const p = new URL(q.path, "https://api.github.com").pathname;
      if (q.method === "GET" && p.includes("/git/ref/heads/")) {
        const b = p.split("/git/ref/heads/")[1];
        return api.refs.has(b)
          ? {
              status: 200,
              headers: {},
              body: {
                ref: "refs/heads/" + b,
                object: { sha: api.refs.get(b) },
              },
            }
          : { status: 404, headers: {}, body: {} };
      }
      return api.request(q);
    },
  };
  dispatcher = await openDispatcher({
    directory,
    configuration: f,
    authority,
    journal: g.journal,
    transport,
    clock: () => time,
  });
  await dispatcher.migrate(migrationInput(f));
  const operation = (c, kind = "create_branch") => ({
    ...structuredClone(g.operation),
    operation_id: "external-" + kind,
    kind,
    claim_id: c.claim_id,
    worker_id: c.worker_id,
    generation: c.generation,
    branch: c.branch,
    expected_head: c.head_sha,
    payload:
      kind === "append_claim"
        ? { record_kind: "claim", status: "in_progress" }
        : {},
  });
  return {
    f,
    g,
    api,
    transport,
    directory,
    authority,
    dispatcher,
    operation,
    async close() {
      await dispatcher.close();
      g.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
