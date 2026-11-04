import {
  constants,
  openSync,
  closeSync,
  readFileSync,
  writeSync,
  fsyncSync,
  unlinkSync,
  lstatSync,
  realpathSync,
  fchmodSync,
} from "node:fs";
import { resolve, relative, sep, join } from "node:path";
import { randomUUID } from "node:crypto";
import { badJson, hash, same, MAX, fail } from "./core.mjs";
import { validateGitHubArtifact } from "./schema.mjs";

export function createFileJournal({ directory, sourceRoot, limits = MAX }) {
  if (
    !Number.isSafeInteger(limits?.journal_bytes) ||
    limits.journal_bytes < 1 ||
    !Number.isSafeInteger(limits.journal_transitions) ||
    limits.journal_transitions < 1
  )
    fail("journal_limit_invalid");
  const root = realpathSync(directory),
    source = realpathSync(sourceRoot),
    rel = relative(source, root);
  if (
    root !== resolve(directory) ||
    !(rel === ".." || rel.startsWith(".." + sep)) ||
    !lstatSync(root).isDirectory() ||
    lstatSync(root).mode & 0o077
  )
    fail("journal_path_invalid");
  const lock = join(root, "controller.lock"),
    path = join(root, "journal.jsonl"),
    owner = randomUUID();
  let lockFd,
    fd,
    closed = false,
    poisoned = false,
    rows = [],
    bytes = 0;
  const removeOwnLock = () => {
    if (lockFd !== undefined) {
      closeSync(lockFd);
      lockFd = undefined;
      if (JSON.parse(readFileSync(lock, "utf8")).owner === owner)
        unlinkSync(lock);
    }
  };
  try {
    lockFd = openSync(lock, "wx", 0o600);
    writeSync(lockFd, JSON.stringify({ owner, pid: process.pid }));
    fsyncSync(lockFd);
    fd = openSync(
      path,
      constants.O_RDWR |
        constants.O_CREAT |
        constants.O_APPEND |
        constants.O_NOFOLLOW,
      0o600,
    );
    fchmodSync(fd, 0o600);
    const directoryFd = openSync(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY,
    );
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
    const text = readFileSync(fd, "utf8");
    bytes = Buffer.byteLength(text);
    if (
      bytes > Math.min(limits.journal_bytes, MAX.journal_bytes) ||
      (text && !text.endsWith("\n"))
    )
      fail("journal_corrupt");
    for (const line of text.split("\n").filter(Boolean)) {
      const row = JSON.parse(line);
      if (
        badJson(row) ||
        Object.keys(row).sort().join() !==
          "digest,previous_digest,record,sequence" ||
        row.sequence !== rows.length + 1 ||
        row.previous_digest !== (rows.at(-1)?.digest ?? null) ||
        row.digest !==
          hash({
            sequence: row.sequence,
            previous_digest: row.previous_digest,
            record: row.record,
          }) ||
        !["admission", "operation"].includes(row.record?.kind)
      )
        fail("journal_corrupt");
      if (
        row.record.kind === "operation" &&
        (!validateGitHubArtifact("receipt", row.record.receipt).valid ||
          Object.keys(row.record).sort().join() !== "kind,receipt")
      )
        fail("journal_corrupt");
      if (
        row.record.kind === "admission" &&
        (Object.keys(row.record).sort().join() !== "data,kind" ||
          !validAdmission(row.record.data))
      )
        fail("journal_corrupt");
      if (row.record.kind === "operation") {
        const prior = rows
          .map((r) => r.record)
          .filter(
            (r) =>
              r.kind === "operation" &&
              r.receipt.operation_id === row.record.receipt.operation_id,
          )
          .at(-1)?.receipt;
        if (!validTransition(prior, row.record.receipt))
          fail("journal_corrupt");
      }
      if (
        row.record.kind === "admission" &&
        rows.some(
          (r) =>
            r.record.kind === "admission" &&
            (r.record.data.event_id === row.record.data.event_id ||
              r.record.data.nonce === row.record.data.nonce),
        )
      )
        fail("journal_corrupt");
      rows.push(row);
    }
    if (
      rows.length >
      Math.min(limits.journal_transitions, MAX.journal_transitions)
    )
      fail("journal_limit");
  } catch {
    if (fd !== undefined) closeSync(fd);
    if (lockFd !== undefined) removeOwnLock();
    fail("journal_unavailable");
  }
  const records = () => rows.map((row) => structuredClone(row.record));
  function append(record) {
    if (closed || poisoned || badJson(record)) fail("journal_unavailable");
    const row = {
      sequence: rows.length + 1,
      previous_digest: rows.at(-1)?.digest ?? null,
      record,
    };
    row.digest = hash(row);
    const text = JSON.stringify(row) + "\n";
    if (
      rows.length >=
        Math.min(limits.journal_transitions, MAX.journal_transitions) ||
      bytes + Buffer.byteLength(text) >
        Math.min(limits.journal_bytes, MAX.journal_bytes)
    )
      fail("journal_limit");
    const buffer = Buffer.from(text);
    try {
      let offset = 0;
      while (offset < buffer.length) {
        const written = writeSync(fd, buffer, offset, buffer.length - offset);
        if (written <= 0) fail("journal_unavailable");
        offset += written;
      }
      fsyncSync(fd);
    } catch {
      poisoned = true;
      fail("journal_unavailable");
    }
    rows.push(structuredClone(row));
    bytes += buffer.length;
  }
  function latest(id) {
    return records()
      .filter((r) => r.kind === "operation" && r.receipt.operation_id === id)
      .at(-1)?.receipt;
  }
  return {
    durable: true,
    directory: root,
    records,
    admitted(data) {
      return records().some(
        (r) => r.kind === "admission" && same(r.data, data),
      );
    },
    admit(data) {
      if (!validAdmission(data)) return false;
      const prior = records().find(
        (r) =>
          r.kind === "admission" &&
          (r.data.event_id === data.event_id || r.data.nonce === data.nonce),
      );
      if (prior) return same(prior.data, data);
      append({ kind: "admission", data: structuredClone(data) });
      return true;
    },
    latest,
    pending(except) {
      const latestRows = new Map(
        records()
          .filter((r) => r.kind === "operation")
          .map((r) => [r.receipt.operation_id, r.receipt]),
      );
      return [...latestRows.values()].some(
        (r) =>
          r.operation_id !== except &&
          (["prepared", "sending", "unknown"].includes(r.status) ||
            (r.status === "failed" && r.partial)),
      );
    },
    append(receipt) {
      const permitted = [
        "schema_version",
        "artifact_kind",
        "operation_id",
        "operation_kind",
        "repository",
        "repository_id",
        "issue_number",
        "run_id",
        "claim_id",
        "worker_id",
        "generation",
        "branch",
        "expected_head",
        "policy_digest",
        "grant_digest",
        "input_digest",
        "status",
        "recorded_at",
        "step",
        "request_count",
        "confirmed_steps",
        "expected",
        "observed",
        "diagnostics",
        "partial",
      ];
      if (
        !validateGitHubArtifact("receipt", receipt).valid ||
        Object.keys(receipt).some((k) => !permitted.includes(k))
      )
        fail("journal_record_invalid");
      const prior = latest(receipt.operation_id);
      if (!validTransition(prior, receipt)) fail("journal_transition_invalid");
      append({ kind: "operation", receipt: structuredClone(receipt) });
      return structuredClone(receipt);
    },
    close() {
      if (closed) return;
      closed = true;
      closeSync(fd);
      removeOwnLock();
    },
  };
}
function validAdmission(data) {
  return (
    !badJson(data) &&
    !!data &&
    Object.keys(data).sort().join() ===
      "event_id,nonce,request_digest,run_id" &&
    ["event_id", "nonce", "run_id"].every(
      (k) => typeof data[k] === "string" && /^[a-z0-9_-]{1,128}$/.test(data[k]),
    ) &&
    /^[a-f0-9]{64}$/.test(data.request_digest)
  );
}
function validTransition(prior, next) {
  if (!prior)
    return (
      next.status === "prepared" &&
      next.step === 0 &&
      next.confirmed_steps === 0
    );
  const stable = [
    "operation_id",
    "operation_kind",
    "repository",
    "repository_id",
    "issue_number",
    "run_id",
    "claim_id",
    "worker_id",
    "generation",
    "branch",
    "expected_head",
    "policy_digest",
    "grant_digest",
    "input_digest",
  ];
  if (
    stable.some((k) => prior[k] !== next[k]) ||
    next.request_count < prior.request_count ||
    next.confirmed_steps < prior.confirmed_steps ||
    Date.parse(next.recorded_at) < Date.parse(prior.recorded_at)
  )
    return false;
  if (
    !(
      {
        prepared: ["sending", "failed"],
        sending: ["prepared", "confirmed", "unknown", "failed"],
        unknown: ["unknown", "confirmed", "failed"],
        confirmed: ["confirmed"],
        failed: ["failed"],
      }[prior.status] ?? []
    ).includes(next.status)
  )
    return false;
  if (next.status === "prepared")
    return (
      next.step === prior.step + 1 && next.confirmed_steps === prior.step + 1
    );
  return next.step === prior.step && same(next.expected, prior.expected);
}
