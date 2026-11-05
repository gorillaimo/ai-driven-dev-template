import { generateKeyPairSync, sign } from "node:crypto";
import { canonical, hash, MAX, OPS, nowValid, fail, badJson } from "./core.mjs";

// Synthetic trial issuer only. It authenticates no real human/session. The
// returned records carry unknown P1 facts and must never enable production mode.
export function createTrialRecordFactory({
  manifest: m,
  sourceSha,
  runId,
  clock,
}) {
  if (
    badJson(m) ||
    m?.version !== 1 ||
    !/^[a-f0-9]{40}$/.test(sourceSha) ||
    !/^[a-z0-9_-]{1,64}$/.test(runId) ||
    typeof clock !== "function" ||
    !Array.isArray(m.manual_sources) ||
    !Array.isArray(m.proof_sources) ||
    m.proof_sources.length !== 2 ||
    new Set(m.proof_sources).size !== 2
  )
    fail("trial_records_invalid");
  const target = m.target,
    start = clock();
  if (!nowValid(start)) fail("trial_clock_invalid");
  const end = new Date(Date.parse(start) + 900000).toISOString(),
    keys = generateKeyPairSync("ed25519"),
    issuer = "synthetic-actions-trial",
    keyId = "ephemeral-trial-key";
  const reference = (id, digest) => ({
    kind: "source",
    id,
    revision: 1,
    digest,
    location: { kind: "id", target: id },
  });
  const manifestRef = reference("trial-manifest", hash(m));
  const envelope = (kind, id) => ({
    schema_version: 1,
    artifact_kind: kind,
    artifact_id: id,
    revision: 1,
    repository: target.repository,
    recorded_at: start,
    recorded_by: { actor_type: "system", actor_ref: "github-trial-controller" },
    input_digest: hash({ manifest: m, sourceSha, runId }),
    evidence_refs: [manifestRef],
  });
  const proofRefs = m.proof_sources.map((id) =>
    reference(
      "trial-source-" + id,
      hash(m.manual_sources.find((v) => v.id === id)),
    ),
  );
  const profile = {
    ...envelope("profile", "trial-profile"),
    human_owner: target.owner.login,
    risk: "high",
    allowed_stages: ["implementation", "validation", "handoff"],
    allowed_paths: [target.path],
    forbidden_paths: ["README.md", ".github", ".git", "secrets"],
    required_acs: ["ac-live-github"],
    review_required: true,
    review_omission_reason: "",
    max_age_seconds: 900,
    stop_severities: ["critical", "high"],
    delegates: [],
    commands: [],
    checks: [
      {
        check_id: "trial-readback",
        kind: "verification",
        domain: "template",
        acs: ["ac-live-github"],
      },
    ],
    limits: {
      max_issues: 1,
      max_concurrent_issues: 1,
      max_ai_processes: 1,
      run_seconds: 900,
      cleanup_seconds: 60,
      call_seconds: 180,
      max_repairs: 1,
      cost: { status: "known", amount: 0, unit: "no-llm-trial" },
    },
    approval_refs: [proofRefs[0]],
  };
  const profileRef = {
    kind: "profile",
    id: profile.artifact_id,
    revision: 1,
    digest: hash(profile),
    location: { kind: "id", target: profile.artifact_id },
  };
  const policy = {
    schema_version: 1,
    artifact_kind: "github-policy",
    artifact_id: "actions-trial-policy",
    revision: 1,
    repository: target.repository,
    repository_id: target.repository_id,
    owner: target.owner,
    delegates: [],
    profile: profileRef,
    mode: "trial",
    reviewed_at: start,
    expires_at: end,
    base_branch: target.base_branch,
    branch_prefix: "ai-work/",
    protected_branches: [target.base_branch],
    allowed_operations: [...OPS],
    allowed_paths: [target.path],
    forbidden_paths: [...profile.forbidden_paths],
    ttl_seconds: 60,
    request_ttl_seconds: 300,
    monitor_seconds: 30,
    limits: { ...MAX },
    manual_mappings: m.manual_sources.map((v) => ({
      id: v.id,
      body_digest: v.body_digest,
      disposition: "not_claim",
    })),
  };
  const signed = (kind, payload) => ({
    schema_version: 1,
    artifact_kind: kind,
    issuer,
    key_id: keyId,
    payload,
    signature: sign(
      null,
      Buffer.from(
        "workflow-github:v1:" +
          kind +
          "\n" +
          canonical({ issuer, key_id: keyId, payload }),
      ),
      keys.privateKey,
    ).toString("base64"),
  });
  const request = signed("session-request", {
    event_id: runId + "-request",
    session_id: runId + "-session",
    nonce: runId + "-nonce",
    audience: "workflow-github",
    repository_id: target.repository_id,
    owner_id: target.owner.id,
    actor_id: target.owner.id,
    run_id: runId,
    policy_digest: hash(policy),
    profile_digest: hash(profile),
    intent: "continue",
    issued_at: start,
    expires_at: new Date(Date.parse(start) + 300000).toISOString(),
  });
  return {
    policy,
    keys: [
      {
        issuer,
        key_id: keyId,
        public_key: keys.publicKey.export({ type: "spki", format: "pem" }),
        expires_at: end,
        human_attestation: true,
      },
    ],
    make(snapshot, credential, head) {
      const issue = snapshot.issues.find(
        (v) => v.number === target.issue_number,
      );
      if (
        !issue ||
        issue.id !== m.approved_issue.id ||
        issue.contract_digest !== m.approved_issue.contract_digest ||
        !/^[a-f0-9]{40}$/.test(head)
      )
        fail("trial_contract_changed");
      for (const expected of m.manual_sources) {
        const source = snapshot.sources.find(
          (v) => v.kind === "comment" && v.id === expected.id,
        );
        if (
          !source ||
          source.actor_id !== expected.actor_id ||
          source.actor_type !== expected.actor_type ||
          source.body_digest !== expected.body_digest ||
          source.updated_at !== expected.updated_at ||
          source.state !== "active"
        )
          fail("trial_source_changed");
      }
      const selected = {
        issue_number: target.issue_number,
        work_id: "issue-" + target.issue_number,
        run_id: runId,
        attempt: 1,
        base_sha: target.base_sha,
        head_sha: head,
        plan: {
          id: "trial-plan",
          revision: 1,
          digest: hash({ target, sourceSha }),
        },
        profile: profileRef,
        contract_digest: issue.contract_digest,
        design_digest: hash({ target, sourceSha }),
        stages: [...profile.allowed_stages],
        allowed_paths: [target.path],
        forbidden_paths: [...profile.forbidden_paths],
        shared_areas: [],
        approval_refs: [proofRefs[1]],
      };
      const grant = {
        ...envelope("grant", "trial-grant"),
        run_id: runId,
        profile: profileRef,
        human_owner: target.owner.login,
        request: {
          mode: "continue",
          actor: { actor_type: "human", actor_ref: target.owner.login },
          reference: reference(request.payload.event_id, hash(request)),
        },
        policy_approval_refs: [proofRefs[0]],
        issued_at: start,
        expires_at: end,
        revoked: false,
        selected: [selected],
      };
      const targetDigests = [
        hash({ policy, profile }),
        hash({
          issue_number: target.issue_number,
          contract_digest: selected.contract_digest,
          design_digest: selected.design_digest,
          plan: selected.plan,
          profile: profileRef,
        }),
      ];
      const approvalProofs = m.proof_sources.map((id, index) =>
        signed("approval-proof", {
          kind: index ? "design" : "policy",
          reference: proofRefs[index],
          source: snapshot.sources.find(
            (v) => v.kind === "comment" && v.id === id,
          ),
          target_digest: targetDigests[index],
          actor_id: target.owner.id,
          repository_id: target.repository_id,
          issued_at: start,
          expires_at: end,
        }),
      );
      return {
        input: { policy, profile, grant, snapshot, request, approvalProofs },
        execution: {
          run_id: runId,
          claim_id: runId + "-claim",
          worker_id: runId + "-controller",
          generation: 1,
          branch: target.branch,
          reserved: true,
          stopped: false,
          expected_head: head,
          expires_at: end,
        },
        credential,
      };
    },
  };
}
