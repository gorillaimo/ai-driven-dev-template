import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture, hash, fakeApi, time } from "./fixture.mjs";
import { verifyRunAuthorization } from "../../tools/workflow-github/auth.mjs";
import { executeBrokerOperation } from "../../tools/workflow-github/broker.mjs";
import { createFileJournal } from "../../tools/workflow-github/journal.mjs";
import { createRestTransport } from "../../tools/workflow-github/transport.mjs";
test("unknown operation blocks a different operation and same ID with changed payload", async () => {
  const s = fixture(),
    api = fakeApi();
  try {
    const { capability } = await verifyRunAuthorization(s.input, s.provider);
    api.loseNext("branch");
    const ctx = {
      transport: api,
      journal: s.journal,
      authorityProvider: s.provider,
    };
    assert.equal(
      (await executeBrokerOperation(s.operation, capability, ctx)).status,
      "unknown",
    );
    const changed = { ...s.operation, operation_id: "other" };
    assert.notEqual(
      (await executeBrokerOperation(changed, capability, ctx)).status,
      "confirmed",
    );
    assert.notEqual(
      (
        await executeBrokerOperation(
          { ...s.operation, payload: { other: true } },
          capability,
          ctx,
        )
      ).status,
      "confirmed",
    );
    assert.equal(api.calls.filter((c) => c.method === "POST").length, 1);
  } finally {
    s.close();
  }
});
test("a confirmed receipt cannot hide a later ref change", async () => {
  const s = fixture(),
    api = fakeApi();
  try {
    const { capability } = await verifyRunAuthorization(s.input, s.provider),
      ctx = {
        transport: api,
        journal: s.journal,
        authorityProvider: s.provider,
      };
    assert.equal(
      (await executeBrokerOperation(s.operation, capability, ctx)).status,
      "confirmed",
    );
    api.refs.set(s.operation.branch, "3".repeat(40));
    assert.notEqual(
      (await executeBrokerOperation(s.operation, capability, ctx)).status,
      "confirmed",
    );
    assert.equal(api.calls.filter((c) => c.method === "POST").length, 1);
  } finally {
    s.close();
  }
});
test("journal refuses structural corruption even if the untrusted hash is recalculated", () => {
  const directory = mkdtempSync(join(tmpdir(), "github-journal-schema-")),
    j = createFileJournal({
      directory,
      sourceRoot: new URL("../../", import.meta.url),
    });
  j.close();
  const row = {
    sequence: 1,
    previous_digest: null,
    record: {
      kind: "operation",
      receipt: { status: "confirmed", operation_id: "forged" },
    },
  };
  row.digest = hash(row);
  writeFileSync(join(directory, "journal.jsonl"), JSON.stringify(row) + "\n");
  assert.throws(() =>
    createFileJournal({
      directory,
      sourceRoot: new URL("../../", import.meta.url),
    }),
  );
});
test("journal bounds cannot be disabled through invalid limits", () => {
  for (const value of [0, NaN, Infinity, -1]) {
    const directory = mkdtempSync(join(tmpdir(), "github-journal-limits-"));
    assert.throws(() =>
      createFileJournal({
        directory,
        sourceRoot: new URL("../../", import.meta.url),
        limits: { journal_bytes: value, journal_transitions: 10000 },
      }),
    );
  }
});
test("transport input accessors cannot execute before validation", async () => {
  let invoked = false;
  const t = createRestTransport(
    { repository: "example/synthetic", repositoryId: 1, clock: () => time },
    async () => {
      throw Error("not called");
    },
  );
  const v = Object.defineProperty({}, "method", {
    enumerable: true,
    get() {
      invoked = true;
      return "GET";
    },
  });
  await assert.rejects(() => t.request(v));
  assert.equal(invoked, false);
});
test("read-only adapter rejects unsupported query fields", async () => {
  let calls = 0;
  const t = createRestTransport(
    { repository: "example/synthetic", repositoryId: 1, clock: () => time },
    async () => {
      calls++;
      return { status: 200, headers: {}, body: [] };
    },
  );
  await assert.rejects(() =>
    t.request({
      method: "GET",
      path: "/repos/example/synthetic/issues?access_token=SECRET_CANARY",
    }),
  );
  assert.equal(calls, 0);
});
test("authorization independently rejects duplicate identity observations", async () => {
  const s = fixture();
  try {
    s.state.snapshot.permissions.push({
      ...s.state.snapshot.permissions[0],
      permission: "none",
    });
    const r = await verifyRunAuthorization(s.input, s.provider);
    assert.equal(r.artifact.status, "blocked");
  } finally {
    s.close();
  }
});
test("journal transitions cannot change the operation binding or start confirmed on reopen", async () => {
  const s = fixture(),
    api = fakeApi();
  try {
    const { capability } = await verifyRunAuthorization(s.input, s.provider);
    const r = await executeBrokerOperation(s.operation, capability, {
      transport: api,
      journal: s.journal,
      authorityProvider: s.provider,
    });
    assert.equal(r.status, "confirmed");
    assert.throws(() => s.journal.append({ ...r, run_id: "other-run" }));
    s.close();
    const row = {
      sequence: 1,
      previous_digest: null,
      record: { kind: "operation", receipt: r },
    };
    row.digest = hash(row);
    writeFileSync(
      join(s.directory, "journal.jsonl"),
      JSON.stringify(row) + "\n",
    );
    assert.throws(() =>
      createFileJournal({
        directory: s.directory,
        sourceRoot: new URL("../../", import.meta.url),
      }),
    );
  } finally {
    s.close();
  }
});
test("broker counts the trusted observer API calls in the operation budget", async () => {
  const s = fixture(),
    api = fakeApi();
  try {
    s.state.api_requests = 100;
    const { capability } = await verifyRunAuthorization(s.input, s.provider);
    const r = await executeBrokerOperation(s.operation, capability, {
      transport: api,
      journal: s.journal,
      authorityProvider: s.provider,
    });
    assert.notEqual(r.status, "confirmed");
    assert.equal(api.calls.filter((r) => r.method !== "GET").length, 0);
  } finally {
    s.close();
  }
});
