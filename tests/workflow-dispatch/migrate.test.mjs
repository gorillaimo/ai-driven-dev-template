import test from "node:test";
import assert from "node:assert/strict";
import { fixture, hash, time, claim, migrationInput } from "./fixture.mjs";
import { source } from "../workflow-execution/fixture.mjs";
import { previewMigration } from "../../tools/workflow-dispatch/migrate.mjs";
test("explicit preview binds exact source/target and every manual source", () => {
  const r = previewMigration(migrationInput());
  assert.equal(r.status, "passed", JSON.stringify(r));
  assert.equal(r.authority, false);
  assert.deepEqual(r.imported_claims, []);
});
for (const [name, change] of [
  ["missing manual mapping", (i) => i.migration.dispositions.pop()],
  [
    "changed input digest",
    (i) => (i.migration.inventory_digest = "0".repeat(64)),
  ],
  ["stale inventory", (i) => (i.evaluated_at = "2026-11-04T01:00:00Z")],
  [
    "v1 dispatcher disguise",
    (i) => (i.from.project.coordination_mode = "dispatcher"),
  ],
  ["unknown migration field", (i) => (i.migration.extra = true)],
  [
    "unmapped branch",
    (i) => {
      i.snapshot.branches.push({
        name: "work/old",
        sha: "2".repeat(40),
        protected: false,
      });
      i.migration.inventory_digest = hash({
        snapshot: i.snapshot,
        legacy_claims: i.legacy_claims,
      });
    },
  ],
])
  test("migration refuses " + name, () => {
    const i = migrationInput();
    change(i);
    assert.equal(previewMigration(i).status, "blocked");
  });
test("retained manual claim keeps identity, area and capacity", () => {
  const i = migrationInput(),
    c = claim({ origin: "manual-v1" });
  i.legacy_claims = [c];
  i.migration.dispositions.push({
    kind: "claim",
    id: c.claim_id,
    disposition: "retain",
    claim: c,
    approval_refs: [source("manual-confirmation")],
  });
  i.migration.inventory_digest = hash({
    snapshot: i.snapshot,
    legacy_claims: i.legacy_claims,
  });
  const r = previewMigration(i);
  assert.equal(r.status, "passed", JSON.stringify(r));
  assert.deepEqual(r.imported_claims, [c]);
});
test("a live manual claim cannot be silently marked released during conversion", () => {
  const i = migrationInput(),
    c = claim({ origin: "manual-v1" });
  i.legacy_claims = [c];
  i.migration.dispositions.push({
    kind: "claim",
    id: c.claim_id,
    disposition: "released",
    claim: null,
    approval_refs: [source("manual-confirmation")],
  });
  i.migration.inventory_digest = hash({
    snapshot: i.snapshot,
    legacy_claims: i.legacy_claims,
  });
  assert.equal(previewMigration(i).status, "blocked");
});
