import { MAX as GITHUB_MAX } from "../workflow-github/core.mjs";
import { createClient } from "../workflow-github/client.mjs";
import { isLiveRestTransport } from "../workflow-github/transport.mjs";
import { createPublicKey, createPrivateKey, sign, verify } from "node:crypto";
import { safe, hash, canonical, bounded, fresh, fail } from "./core.mjs";
import { valid } from "./core.mjs";
import { checkProfile } from "./core.mjs";
const authorities = new WeakMap(),
  tickets = new WeakMap();
export function createRunnerAuthority({
  mode,
  keys,
  readSource,
  clock = () => new Date().toISOString(),
}) {
  if (
    !["synthetic", "production"].includes(mode) ||
    !safe(keys) ||
    !Array.isArray(keys) ||
    !keys.length ||
    keys.length > 100 ||
    typeof readSource !== "function" ||
    typeof clock !== "function"
  )
    fail("authority_invalid");
  const registry = new Map();
  for (const row of keys) {
    if (
      Object.keys(row).sort().join() !==
        "expires_at,issuer,key_id,public_key" ||
      typeof row.public_key !== "string" ||
      row.public_key.includes("PRIVATE") ||
      !Number.isFinite(Date.parse(row.expires_at))
    )
      fail("issuer_invalid");
    let key;
    try {
      key = createPublicKey(row.public_key);
    } catch {
      fail("issuer_invalid");
    }
    const id = row.issuer + ":" + row.key_id;
    if (key.asymmetricKeyType !== "ed25519" || registry.has(id))
      fail("issuer_invalid");
    registry.set(id, { ...row, key });
  }
  const value = Object.freeze({});
  authorities.set(value, { mode, registry, readSource, clock });
  return value;
}
export async function verifyRequest(authority, envelope, profile) {
  const a = authorities.get(authority);
  if (
    !a ||
    !safe(envelope) ||
    !valid("request", envelope) ||
    checkProfile(profile, a.clock()).status !== "passed"
  )
    fail("request_invalid");
  const e = structuredClone(envelope),
    p = e.payload,
    now = a.clock(),
    key = a.registry.get(e.issuer + ":" + e.key_id);
  if (
    !key ||
    Date.parse(key.expires_at) <= Date.parse(now) ||
    !fresh(p.issued_at, now) ||
    Date.parse(p.expires_at) <= Date.parse(now) ||
    Date.parse(p.expires_at) - Date.parse(p.issued_at) > 60000 ||
    p.repository_id !== profile.repository_id ||
    p.actor_id !== profile.owner_id ||
    p.runner_profile_digest !== hash(profile)
  )
    fail("request_binding_invalid");
  const signature = Buffer.from(e.signature, "base64");
  if (
    signature.length !== 64 ||
    signature.toString("base64") !== e.signature ||
    !verify(
      null,
      Buffer.from(
        "workflow-runner:v1:request\n" +
          canonical({ issuer: e.issuer, key_id: e.key_id, payload: p }),
      ),
      key.key,
      signature,
    )
  )
    fail("signature_invalid");
  const source = await bounded((signal) =>
    a.readSource({
      repository: profile.repository,
      repository_id: profile.repository_id,
      source_id: p.source_id,
      signal,
    }),
  );
  const normal = {
    continue: ["進めてください", "再開してください"],
    status: ["状況を教えてください"],
    stop: ["停止してください"],
  };
  const expected = [
    hash(
      "workflow " +
        p.intent +
        " " +
        p.run_id +
        " " +
        p.runner_profile_digest +
        " " +
        p.nonce,
    ),
    ...normal[p.intent].map(hash),
  ];
  if (
    !safe(source) ||
    source.id !== p.source_id ||
    source.repository_id !== profile.repository_id ||
    source.actor_id !== profile.owner_id ||
    source.actor_type !== "User" ||
    !["write", "maintain", "admin"].includes(source.permission) ||
    source.state !== "active" ||
    source.updated_at !== p.source_updated_at ||
    Date.parse(source.updated_at) > Date.parse(p.issued_at) ||
    source.body_digest !== p.source_digest ||
    !expected.includes(p.source_digest) ||
    !fresh(source.observed_at, now)
  )
    fail("request_source_invalid");
  const ticket = Object.freeze({});
  tickets.set(ticket, {
    authority,
    profile_digest: hash(profile),
    request: structuredClone(p),
    mode: a.mode,
    expires_at: p.expires_at,
    clock: a.clock,
  });
  return {
    authority: false,
    ticket,
    intent: p.intent,
    run_id: p.run_id,
    mode: a.mode,
  };
}
export function inspectTicket(ticket, authority, profile) {
  const t = tickets.get(ticket);
  if (
    !t ||
    t.authority !== authority ||
    t.profile_digest !== hash(profile) ||
    Date.parse(t.expires_at) <= Date.parse(t.clock())
  )
    fail("ticket_invalid");
  return { ...t, request: structuredClone(t.request) };
}

// Concrete native GitHub boundary. The issuer and its key stay in host code;
// neither the worker nor a repository JSON file may invoke a privileged signer.
const nativeReaders = new WeakMap();
export function createGitHubRequestReader({
  transport,
  mode,
  clock = () => new Date().toISOString(),
}) {
  if (
    !["synthetic", "production"].includes(mode) ||
    typeof transport?.request !== "function" ||
    (mode === "production" && !isLiveRestTransport(transport))
  )
    fail("request_reader_invalid");
  const reader = async ({ repository, repository_id, source_id }) => {
    if (
      typeof repository !== "string" ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      repository.split("/").some((p) => [".", ".."].includes(p)) ||
      !Number.isSafeInteger(repository_id) ||
      !/^[1-9][0-9]{0,19}$/.test(source_id)
    )
      fail("request_source_invalid");
    const client = createClient(transport, {
        repository,
        limits: {
          ...GITHUB_MAX,
          requests: 4,
          resource_items: 10,
          response_bytes: 1048576,
          collector_seconds: 10,
        },
        clock,
      }),
      base = "/repos/" + repository;
    const repositoryView = await client.request("GET", base);
    if (
      repositoryView.status !== 200 ||
      repositoryView.body.id !== repository_id
    )
      fail("request_repository_changed");
    const r = await client.request(
        "GET",
        base + "/issues/comments/" + source_id,
      ),
      v = r.body;
    if (
      r.status !== 200 ||
      !safe(v) ||
      String(v.id) !== source_id ||
      v.user?.type !== "User" ||
      typeof v.user.login !== "string" ||
      !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(v.user.login) ||
      !Number.isSafeInteger(v.user.id) ||
      v.performed_via_github_app ||
      typeof v.body !== "string" ||
      Buffer.byteLength(v.body) > 4096 ||
      typeof v.issue_url !== "string" ||
      !v.issue_url.startsWith(
        "https://api.github.com/repos/" + repository + "/issues/",
      )
    )
      fail("request_source_invalid");
    const permission = await client.request(
      "GET",
      base + "/collaborators/" + v.user.login + "/permission",
    );
    if (
      permission.status !== 200 ||
      permission.body.user?.id !== v.user.id ||
      !["write", "maintain", "admin"].includes(permission.body.permission)
    )
      fail("request_permission_invalid");
    return {
      id: source_id,
      repository_id,
      actor_id: v.user.id,
      actor_type: v.user.type,
      permission: permission.body.permission,
      body_digest: hash(v.body.trim()),
      updated_at: v.updated_at,
      observed_at: clock(),
      state: "active",
    };
  };
  nativeReaders.set(reader, { mode });
  return reader;
}
export function createGitHubRequestIssuer({
  mode,
  issuer,
  key_id,
  private_key,
  reader,
  clock = () => new Date().toISOString(),
}) {
  if (
    nativeReaders.get(reader)?.mode !== mode ||
    typeof issuer !== "string" ||
    typeof key_id !== "string" ||
    typeof private_key !== "string"
  )
    fail("request_issuer_invalid");
  let key;
  try {
    key = createPrivateKey(private_key);
  } catch {
    fail("request_issuer_invalid");
  }
  if (key.asymmetricKeyType !== "ed25519") fail("request_issuer_invalid");
  return Object.freeze({
    async issue({ profile: p, source_id, run_id, intent }) {
      if (
        checkProfile(p, clock()).status !== "passed" ||
        !["continue", "status", "stop"].includes(intent) ||
        typeof run_id !== "string" ||
        !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(run_id)
      )
        fail("request_invalid");
      const s = await bounded(() =>
        reader({
          repository: p.repository,
          repository_id: p.repository_id,
          source_id,
        }),
      );
      const texts = {
        continue: ["進めてください", "再開してください"],
        stop: ["停止してください"],
        status: ["状況を教えてください"],
      };
      if (
        s.actor_id !== p.owner_id ||
        !fresh(s.updated_at, clock()) ||
        !texts[intent].map(hash).includes(s.body_digest)
      )
        fail("request_source_invalid");
      const identity = hash({
          repository_id: p.repository_id,
          source_id,
          updated_at: s.updated_at,
          digest: s.body_digest,
        }),
        payload = {
          event_id: "event-" + identity,
          session_id: "github-" + source_id,
          nonce: "nonce-" + identity,
          repository_id: p.repository_id,
          actor_id: p.owner_id,
          run_id,
          runner_profile_digest: hash(p),
          intent,
          issued_at: clock(),
          expires_at: new Date(Date.parse(clock()) + 60000).toISOString(),
          source_id,
          source_updated_at: s.updated_at,
          source_digest: s.body_digest,
        };
      const e = {
        schema_version: 1,
        artifact_kind: "runner-request",
        issuer,
        key_id,
        payload,
      };
      e.signature = sign(
        null,
        Buffer.from(
          "workflow-runner:v1:request\n" +
            canonical({ issuer, key_id, payload }),
        ),
        key,
      ).toString("base64");
      if (!valid("request", e)) fail("request_invalid");
      return e;
    },
  });
}
