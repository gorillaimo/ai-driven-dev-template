import { createPublicKey, verify } from "node:crypto";
import { validateExecutionArtifact } from "workflow-execution/schema";
import { validateGitHubArtifact as valid } from "./schema.mjs";
import { boundedCall } from "./client.mjs";
import {
  badJson,
  canonical,
  hash,
  same,
  fresh,
  nowValid,
  within,
  PERMISSIONS,
  NOT_EVALUATED,
  fail,
  errorCode,
} from "./core.mjs";

// Provider callbacks and keys belong to the controller, never to worker JSON.
const providers = new WeakMap(),
  capabilities = new WeakMap();
export function createAuthorityProvider({
  mode,
  keys,
  clock,
  journal,
  observe,
}) {
  if (
    !["trial", "production"].includes(mode) ||
    !Array.isArray(keys) ||
    !keys.length ||
    typeof clock !== "function" ||
    typeof observe !== "function" ||
    journal?.durable !== true
  )
    fail("authority_provider_invalid");
  const registry = new Map();
  for (const key of keys) {
    if (
      badJson(key) ||
      Object.keys(key).some(
        (k) =>
          ![
            "issuer",
            "key_id",
            "public_key",
            "expires_at",
            "human_attestation",
          ].includes(k),
      ) ||
      typeof key.public_key !== "string" ||
      key.public_key.includes("PRIVATE") ||
      !nowValid(key.expires_at) ||
      key.human_attestation !== true
    )
      fail("issuer_invalid");
    const parsed = createPublicKey(key.public_key),
      id = key.issuer + "|" + key.key_id;
    if (parsed.asymmetricKeyType !== "ed25519" || registry.has(id))
      fail("issuer_invalid");
    registry.set(id, { ...key, key: parsed });
  }
  const provider = Object.freeze({});
  providers.set(provider, { mode, registry, clock, journal, observe });
  return provider;
}
function signature(envelope, provider, now, revoked = []) {
  const key = provider.registry.get(envelope.issuer + "|" + envelope.key_id);
  if (
    !key ||
    Date.parse(key.expires_at) <= Date.parse(now) ||
    revoked.includes(envelope.issuer)
  )
    return false;
  const bytes = Buffer.from(envelope.signature, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== envelope.signature)
    return false;
  return verify(
    null,
    Buffer.from(
      "workflow-github:v1:" +
        envelope.artifact_kind +
        "\n" +
        canonical({
          issuer: envelope.issuer,
          key_id: envelope.key_id,
          payload: envelope.payload,
        }),
    ),
    key.key,
    bytes,
  );
}
const reference = (id, digest) => ({
  kind: "source",
  id,
  revision: 1,
  digest,
  location: { kind: "id", target: id },
});
function authorityView(snapshot) {
  const copy = structuredClone(snapshot);
  delete copy.started_at;
  delete copy.finished_at;
  delete copy.pages;
  for (const row of [...copy.permissions, ...copy.protections])
    delete row.observed_at;
  return copy;
}
function mappingKnown(policy, snapshot) {
  const ids = new Set();
  for (const row of policy.manual_mappings) {
    if (ids.has(row.id)) return false;
    ids.add(row.id);
  }
  return snapshot.sources
    .filter((s) => s.kind === "comment" && !s.machine)
    .every((s) =>
      policy.manual_mappings.some(
        (m) =>
          m.id === s.id &&
          m.body_digest === s.body_digest &&
          ["not_claim", "released_claim"].includes(m.disposition),
      ),
    );
}
async function inspect(
  input,
  provider,
  { admitted = false, phase = "admission" } = {},
) {
  if (
    badJson(input) ||
    !input ||
    Object.keys(input).some(
      (k) =>
        ![
          "policy",
          "profile",
          "grant",
          "snapshot",
          "request",
          "approvalProofs",
        ].includes(k),
    )
  )
    fail("input_invalid");
  const {
    policy: p,
    profile,
    grant: g,
    request: r,
    approvalProofs: proofs,
  } = input;
  let s = input.snapshot,
    now = provider.clock();
  if (
    !nowValid(now) ||
    !valid("policy", p).valid ||
    !valid("snapshot", s).valid ||
    !valid("session-request", r).valid ||
    !validateExecutionArtifact("profile", profile).valid ||
    !validateExecutionArtifact("grant", g).valid ||
    !Array.isArray(proofs) ||
    proofs.length > 1000 ||
    proofs.some((x) => !valid("proof", x).valid)
  )
    fail("schema_invalid");
  if (
    provider.mode !== p.mode ||
    p.repository !== profile.repository ||
    p.repository !== g.repository ||
    p.repository !== s.repository ||
    p.repository_id !== s.repository_id ||
    p.owner.login !== profile.human_owner ||
    g.human_owner !== p.owner.login ||
    !same(p.profile, g.profile) ||
    p.profile.kind !== "profile" ||
    p.profile.id !== profile.artifact_id ||
    p.profile.revision !== profile.revision ||
    p.profile.digest !== hash(profile) ||
    s.policy_digest !== hash(p)
  )
    fail("binding_mismatch");
  const observed = await boundedCall(
    (signal) =>
      provider.observe({
        phase,
        repository: p.repository,
        repository_id: p.repository_id,
        run_id: g.run_id,
        signal,
      }),
    10000,
  );
  now = provider.clock();
  if (!nowValid(now)) fail("time_invalid");
  if (
    badJson(observed) ||
    !observed ||
    !valid("snapshot", observed.snapshot).valid ||
    !same(authorityView(observed.snapshot), authorityView(s))
  )
    fail("observation_mismatch");
  s = observed.snapshot;
  if (
    !Number.isSafeInteger(observed.api_requests) ||
    observed.api_requests < 0 ||
    observed.api_requests > 400
  )
    fail("observation_usage_unknown");
  const { execution: x, credential: c } = observed,
    revoked = observed.revoked_issuers ?? [];
  if (
    !Array.isArray(revoked) ||
    !signature(r, provider, now, revoked) ||
    r.payload.intent !== "continue"
  )
    fail("request_invalid");
  const q = r.payload,
    admission = {
      event_id: q.event_id,
      nonce: q.nonce,
      run_id: q.run_id,
      request_digest: hash(r),
    },
    existing = provider.journal.admitted(admission);
  if (
    !fresh(q.issued_at, now, profile.limits.run_seconds) ||
    Date.parse(q.expires_at) <= Date.parse(q.issued_at) ||
    Date.parse(q.expires_at) - Date.parse(q.issued_at) >
      p.request_ttl_seconds * 1000 ||
    (!existing &&
      (!fresh(q.issued_at, now, p.request_ttl_seconds) ||
        Date.parse(q.expires_at) <= Date.parse(now)))
  )
    fail("request_expired");
  if (admitted && !existing) fail("request_invalid");
  if (
    q.audience !== "workflow-github" ||
    q.repository_id !== p.repository_id ||
    q.owner_id !== p.owner.id ||
    q.run_id !== g.run_id ||
    q.policy_digest !== hash(p) ||
    q.profile_digest !== hash(profile) ||
    g.request.mode !== "continue" ||
    g.request.actor.actor_type !== "human" ||
    g.request.reference.digest !== hash(r) ||
    g.request.reference.id !== q.event_id
  )
    fail("request_invalid");
  const actor = s.permissions.find(
    (a) => a.actor_id === q.actor_id && a.login === g.request.actor.actor_ref,
  );
  const principal = (id) =>
    id === p.owner.id ||
    p.delegates?.some(
      (d) =>
        d.id === id &&
        profile.delegates.includes(d.login) &&
        s.permissions.some((v) => v.actor_id === id && v.login === d.login),
    );
  if (
    !actor ||
    !principal(q.actor_id) ||
    ![p.owner.login, ...profile.delegates].includes(actor.login) ||
    (actor.login === p.owner.login && q.actor_id !== p.owner.id) ||
    !["write", "maintain", "admin"].includes(actor.permission) ||
    !fresh(actor.observed_at, now, p.ttl_seconds)
  )
    fail("actor_invalid");
  if (
    Date.parse(p.reviewed_at) > Date.parse(now) ||
    Date.parse(p.expires_at) <= Date.parse(now) ||
    g.revoked ||
    Date.parse(g.issued_at) < Date.parse(q.issued_at) ||
    Date.parse(g.issued_at) > Date.parse(now) ||
    Date.parse(g.expires_at) <= Date.parse(now) ||
    Date.parse(g.expires_at) <= Date.parse(g.issued_at) ||
    Date.parse(g.expires_at) - Date.parse(g.issued_at) >
      profile.limits.run_seconds * 1000 ||
    profile.limits.cost.status !== "known"
  )
    fail("authorization_expired");
  if (
    s.status !== "complete" ||
    s.unresolved.length ||
    Object.values(s.sections).some((v) => v !== "complete") ||
    !fresh(s.started_at, now, p.ttl_seconds) ||
    !fresh(s.finished_at, now, p.ttl_seconds) ||
    Date.parse(s.started_at) > Date.parse(s.finished_at) ||
    !mappingKnown(p, s)
  )
    fail("inventory_unknown");
  for (const [rows, key] of [
    [s.issues, (v) => v.number],
    [s.issues, (v) => v.id],
    [s.prs, (v) => v.number],
    [s.prs, (v) => v.id],
    [s.branches, (v) => v.name],
    [s.sources, (v) => v.kind + "|" + v.id],
    [s.permissions, (v) => v.actor_id],
    [s.permissions, (v) => v.login],
    [s.protections, (v) => v.branch],
  ])
    if (new Set(rows.map(key)).size !== rows.length) fail("inventory_conflict");
  if (
    s.default_branch !== p.base_branch ||
    !p.protected_branches.includes(s.default_branch)
  )
    fail("protection_unknown");
  if (
    !c ||
    c.kind !== "github_app" ||
    !Number.isSafeInteger(c.app_id) ||
    c.app_id < 1 ||
    !Number.isSafeInteger(c.actor_id) ||
    c.actor_id < 1 ||
    c.actor_id === p.owner.id ||
    !same(c.repository_ids, [p.repository_id]) ||
    !same(c.permissions, PERMISSIONS) ||
    !nowValid(c.expires_at) ||
    Date.parse(c.expires_at) <= Date.parse(now)
  )
    fail("credential_invalid");
  if (
    s.sources.some(
      (source) =>
        source.machine &&
        (source.actor_type !== "Bot" ||
          source.actor_id !== c.actor_id ||
          source.machine.repository_id !== p.repository_id ||
          source.machine.issue_number !== source.issue_number),
    )
  )
    fail("machine_authority_unknown");
  for (const branch of p.protected_branches) {
    const protection = s.protections.find((v) => v.branch === branch);
    if (
      !protection ||
      protection.enforced !== true ||
      !Array.isArray(protection.bypass_actors) ||
      protection.bypass_actors.includes(c.actor_id) ||
      protection.bypass_actors.includes(c.app_id) ||
      !fresh(protection.observed_at, now, p.ttl_seconds)
    )
      fail("protection_unknown");
  }
  if (
    !x ||
    x.run_id !== g.run_id ||
    x.reserved !== true ||
    x.stopped !== false ||
    !Number.isSafeInteger(x.generation) ||
    x.generation < 1 ||
    !nowValid(x.expires_at) ||
    Date.parse(x.expires_at) <= Date.parse(now)
  )
    fail("execution_authority_invalid");
  if (
    !g.selected.length ||
    g.selected.length > profile.limits.max_issues ||
    g.selected.length > 100 ||
    new Set(g.selected.map((t) => t.issue_number)).size !== g.selected.length
  )
    fail("selection_invalid");
  const proofIds = new Set();
  for (const proof of proofs) {
    const a = proof.payload,
      key = a.kind + "|" + a.reference.id + "|" + a.target_digest;
    if (
      proofIds.has(key) ||
      !signature(proof, provider, now, revoked) ||
      a.repository_id !== p.repository_id ||
      Date.parse(a.issued_at) > Date.parse(now) ||
      Date.parse(a.expires_at) <= Date.parse(now) ||
      Date.parse(a.expires_at) <= Date.parse(a.issued_at)
    )
      fail("approval_invalid");
    proofIds.add(key);
    const src = s.sources.find(
      (v) => v.id === a.source.id && v.kind === a.source.kind,
    );
    if (
      !src ||
      !same(src, a.source) ||
      src.state !== "active" ||
      src.actor_type !== "User" ||
      src.actor_id !== a.actor_id ||
      Date.parse(src.updated_at) > Date.parse(a.issued_at) ||
      Date.parse(src.updated_at) > Date.parse(s.finished_at)
    )
      fail("approval_invalid");
    const approver = s.permissions.find((v) => v.actor_id === a.actor_id);
    if (
      !approver ||
      !principal(a.actor_id) ||
      ![p.owner.login, ...profile.delegates].includes(approver.login) ||
      !["write", "maintain", "admin"].includes(approver.permission) ||
      !fresh(approver.observed_at, now, p.ttl_seconds)
    )
      fail("approval_invalid");
  }
  const hasProof = (kind, ref, target) =>
    proofs.some(
      (v) =>
        v.payload.kind === kind &&
        same(v.payload.reference, ref) &&
        v.payload.target_digest === target,
    );
  for (const ref of [...g.policy_approval_refs, ...profile.approval_refs])
    if (!hasProof("policy", ref, hash({ policy: p, profile })))
      fail("approval_missing");
  for (const target of g.selected) {
    const issue = s.issues.find((i) => i.number === target.issue_number);
    if (
      !issue ||
      issue.state !== "open" ||
      !issue.labels.includes("ready-for-ai") ||
      !issue.assignees.some(
        (a) => a.id === p.owner.id && a.login === p.owner.login,
      ) ||
      issue.contract_digest !== target.contract_digest ||
      Date.parse(issue.updated_at) > Date.parse(s.finished_at) ||
      target.work_id !== "issue-" + target.issue_number ||
      target.run_id !== g.run_id ||
      !same(target.profile, p.profile) ||
      target.stages.some((v) => !profile.allowed_stages.includes(v)) ||
      target.allowed_paths.some(
        (v) =>
          !within(v, p.allowed_paths) ||
          !within(v, profile.allowed_paths) ||
          within(v, p.forbidden_paths) ||
          within(v, profile.forbidden_paths),
      ) ||
      [...p.forbidden_paths, ...profile.forbidden_paths].some(
        (v) => !target.forbidden_paths.includes(v),
      )
    )
      fail("selection_invalid");
    if (g.requested_issues && !g.requested_issues.includes(target.issue_number))
      fail("selection_invalid");
    const targetDigest = hash({
      issue_number: target.issue_number,
      contract_digest: target.contract_digest,
      design_digest: target.design_digest,
      plan: target.plan,
      profile: target.profile,
    });
    if (
      !target.approval_refs.length ||
      target.approval_refs.some((ref) => !hasProof("design", ref, targetDigest))
    )
      fail("approval_missing");
  }
  if (!existing && provider.journal.pending()) fail("operation_unresolved");
  if (!existing && !provider.journal.admit(admission)) fail("request_replayed");
  return {
    input: { ...structuredClone(input), snapshot: structuredClone(s) },
    observed: structuredClone(observed),
    now,
  };
}
export async function verifyRunAuthorization(input, provider) {
  const configuration = providers.get(provider);
  let now;
  try {
    now = configuration?.clock?.();
  } catch {}
  const artifact = {
    schema_version: 1,
    artifact_kind: "github-authorization",
    status: "blocked",
    recorded_at: nowValid(now) ? now : new Date(0).toISOString(),
    diagnostics: [],
    not_evaluated: [...NOT_EVALUATED],
  };
  if (!configuration) {
    artifact.diagnostics = [{ code: "authority_provider_invalid" }];
    return { artifact, facts: [] };
  }
  try {
    const data = await inspect(input, configuration),
      { policy, profile, grant, snapshot, request, approvalProofs } =
        data.input;
    Object.assign(artifact, {
      status: "allowed",
      policy_digest: hash(policy),
      profile_digest: hash(profile),
      grant_digest: hash(grant),
      snapshot_digest: hash(snapshot),
      request_digest: hash(request),
      proof_digests: approvalProofs.map(hash),
      actor_id: request.payload.actor_id,
      run_id: grant.run_id,
      valid_until: new Date(
        Math.min(
          Date.parse(data.now) + policy.ttl_seconds * 1000,
          Date.parse(grant.expires_at),
          Date.parse(policy.expires_at),
          Date.parse(data.observed.credential.expires_at),
        ),
      ).toISOString(),
    });
    const capability = Object.freeze({});
    capabilities.set(capability, { provider, data });
    const facts = [
      "identity",
      "authority",
      "inventory",
      "approval",
      "assignment",
      "ready",
    ].map((fact_id) => ({
      fact_id,
      value: configuration.mode === "production" ? true : "unknown",
      observed_at: data.now,
      evidence_refs: [reference("github-authorization", hash(artifact))],
    }));
    return {
      artifact,
      capability,
      facts,
      execution: structuredClone(data.observed.execution),
    };
  } catch (error) {
    artifact.diagnostics = [{ code: errorCode(error, "authorization_failed") }];
    return { artifact, facts: [] };
  }
}
export async function inspectCapability(
  capability,
  provider,
  journal,
  { phase = "operation" } = {},
) {
  const cap = capabilities.get(capability),
    configuration = providers.get(provider);
  if (
    !cap ||
    cap.provider !== provider ||
    !configuration ||
    configuration.journal !== journal
  )
    fail("capability_invalid");
  if (
    !["operation", "mutation", "reconciliation", "projection"].includes(phase)
  )
    fail("observation_phase_invalid");
  return inspect(cap.data.input, configuration, { admitted: true, phase });
}
