import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parseDocument, visit } from 'yaml';

const root = new URL('../../', import.meta.url);
const kinds = ['plan', 'state', 'traceability', 'brownfield'];
const schemaDir = new URL('.ai-workflow/schemas/issue/v1/', root);
const fixtures = new URL('tests/workflow-schema/fixtures/v1/', root);
const cases = JSON.parse(readFileSync(new URL('tests/workflow-schema/cases.json', root), 'utf8'));
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);
// No loadSchema callback: all URNs must resolve from this local registry.
for (const name of ['common', ...kinds]) {
  const schema = JSON.parse(readFileSync(new URL(name + '.schema.json', schemaDir), 'utf8'));
  assert.equal(ajv.validateSchema(schema), true, 'Invalid meta-schema: ' + name);
  ajv.addSchema(schema);
}
const validators = Object.fromEntries(kinds.map(kind =>
  [kind, ajv.getSchema('urn:ai-workflow:issue:v1:' + kind)]));

function parseYaml(file) {
  const doc = parseDocument(readFileSync(file, 'utf8'), { version: '1.2', uniqueKeys: true });
  if (doc.errors.length || doc.warnings.length) throw new Error('yaml');
  // Aliases and custom tags are unnecessary for these small, portable artifacts.
  visit(doc, { Alias() { throw new Error('yaml'); } });
  return doc.toJS({ maxAliasCount: 0 });
}

function diagnostics(kind, value) {
  const validate = validators[kind];
  const valid = validate(value);
  const errors = (validate.errors ?? []).map(({ instancePath, schemaPath, keyword }) =>
    ({ artifact: kind, instancePath, schemaPath, keyword }));
  errors.sort((a, b) => {
    const x = JSON.stringify(a), y = JSON.stringify(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return { valid, errors };
}

test('case manifest has unique IDs and covers every committed fixture', () => {
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length);
  for (const dir of ['valid', 'invalid']) {
    for (const name of readdirSync(new URL(dir + '/', fixtures))) {
      assert.ok(cases.some(c => c.file === dir + '/' + name), 'Unlisted fixture: ' + name);
    }
  }
});

for (const kind of kinds) {
  test('template: ' + kind, () => {
    const value = parseYaml(new URL('.ai-workflow/templates/issue/v1/' + kind + '.yaml', root));
    const result = diagnostics(kind, value);
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  });
}

test('all standard event types remain representable', () => {
  const value = parseYaml(new URL('valid/state.yaml', fixtures));
  for (const type of [
    'work_planned', 'plan_revised', 'stage_started', 'stage_completed', 'stage_skipped',
    'approval_requested', 'approval_recorded', 'work_paused', 'work_resumed',
    'work_blocked', 'work_failed', 'work_cancelled', 'work_completed',
  ]) {
    value.history[0].event_type = type;
    assert.equal(diagnostics('state', value).valid, true, type);
  }
});

test('structural validation does not claim to check reference existence or event uniqueness', () => {
  const value = parseYaml(new URL('valid/state.yaml', fixtures));
  value.history.push(structuredClone(value.history[0]));
  value.history[0].evidence = [{ kind: 'file', target: 'does-not-exist.md' }];
  assert.equal(diagnostics('state', value).valid, true);
});

for (const item of cases) {
  test(item.id, () => {
    const file = new URL(item.file, fixtures);
    if (item.keyword === 'yaml') {
      assert.throws(() => parseYaml(file), /yaml/);
      return;
    }
    const value = parseYaml(file);
    if (item.changes?.length) {
      const baseline = diagnostics(item.kind, value);
      assert.equal(baseline.valid, true, 'Mutation base must be valid: ' + JSON.stringify(baseline.errors));
    }
    for (const change of item.changes ?? []) {
      const parent = change.path.slice(0, -1).reduce((obj, key) => obj[key], value);
      const key = change.path.at(-1);
      if (change.remove) delete parent[key];
      else parent[key] = structuredClone(change.value);
    }
    const before = JSON.stringify(value);
    const result = diagnostics(item.kind, value);
    assert.equal(result.valid, item.valid, JSON.stringify(result.errors));
    if (item.keyword) assert.ok(result.errors.some(e => e.keyword === item.keyword), JSON.stringify(result.errors));
    assert.deepEqual(diagnostics(item.kind, value), result, 'Non-deterministic diagnostics');
    assert.equal(JSON.stringify(value), before, 'Validation mutated the artifact');
  });
}

// Autonomy settings are an independent contract; no run/authority is created.
const autonomyFixture = () => ({
  schema_version: 1, artifact_kind: 'autonomy-settings', revision: 1,
  limits: { issues: 2, minutes: 60, parallel_issues: 1, repair_rounds: 2 },
  quota: { stop_new_remaining_percent: 30, checkpoint_remaining_percent: 15 },
});

test('autonomy configured file is valid and remains unchanged', () => {
  const value = readAutonomySettings();
  const before = readFileSync(new URL('.ai-workflow/autonomy.yaml', root));
  assert.deepEqual(autonomyDiagnostics(value), { valid: true, codes: [] });
  assert.equal(readFileSync(new URL('.ai-workflow/autonomy.yaml', root)).equals(before), true);
});

test('autonomy defaults, user changes and inclusive bounds remain valid without mutation', () => {
  const values = [autonomyFixture()];
  for (const [field, choices] of Object.entries({
    issues: [1, 3, 10], minutes: [11, 90, 360], parallel_issues: [1, 2], repair_rounds: [0, 3],
  })) for (const choice of choices) {
    const value = autonomyFixture(); value.limits[field] = choice; values.push(value);
  }
  for (const [checkpoint, stop] of [[1, 2], [15, 30], [99, 100]]) {
    const value = autonomyFixture();
    value.quota = { checkpoint_remaining_percent: checkpoint, stop_new_remaining_percent: stop };
    values.push(value);
  }
  for (const value of values) {
    const before = structuredClone(value);
    assert.deepEqual(autonomyDiagnostics(value), { valid: true, codes: [] });
    assert.deepEqual(autonomyDiagnostics(value), autonomyDiagnostics(value));
    assert.deepEqual(value, before);
  }
});

for (const [field, badValues] of Object.entries({
  issues: [0, 11], minutes: [10, 361], parallel_issues: [0, 3], repair_rounds: [-1, 4],
})) for (const bad of badValues) test(`autonomy rejects out-of-range ${field} ${bad}`, () => {
  const value = autonomyFixture(); value.limits[field] = bad;
  assert.deepEqual(autonomyDiagnostics(value), { valid: false, codes: ['autonomy_schema_invalid'] });
});

test('autonomy rejects invalid types, fractions, nonfinite numbers and missing or unknown keys', () => {
  const baseline = autonomyFixture();
  const groups = [[], ['limits'], ['quota']];
  for (const group of groups) {
    const base = group.length ? baseline[group[0]] : baseline;
    for (const key of Object.keys(base)) {
      const missing = autonomyFixture(), target = group.length ? missing[group[0]] : missing;
      delete target[key];
      assert.deepEqual(autonomyDiagnostics(missing), { valid: false, codes: ['autonomy_schema_invalid'] });
      if (typeof base[key] === 'number') for (const bad of ['2', null, true, 1.5, NaN, Infinity, -Infinity]) {
        const value = autonomyFixture(); (group.length ? value[group[0]] : value)[key] = bad;
        assert.equal(autonomyDiagnostics(value).valid, false);
      }
    }
    const extra = autonomyFixture();
    (group.length ? extra[group[0]] : extra)['private-key-name'] = 'credential-sentinel';
    assert.deepEqual(autonomyDiagnostics(extra), { valid: false, codes: ['autonomy_schema_invalid'] });
  }
  for (const bad of [null, [], 'credential-sentinel', true]) assert.equal(autonomyDiagnostics(bad).valid, false);
  for (const field of ['schema_version', 'artifact_kind']) {
    const value = autonomyFixture(); value[field] = field === 'schema_version' ? 2 : 'unknown';
    assert.equal(autonomyDiagnostics(value).valid, false);
  }
  for (const group of ['limits', 'quota']) for (const bad of [null, [], 'invalid']) {
    const value = autonomyFixture(); value[group] = bad;
    assert.equal(autonomyDiagnostics(value).valid, false);
  }
  const revision = autonomyFixture(); revision.revision = 0;
  assert.equal(autonomyDiagnostics(revision).valid, false);
});

test('autonomy rejects threshold bounds and contradictory threshold or parallel settings', () => {
  for (const [checkpoint, stop] of [[0, 30], [100, 100], [15, 1], [15, 101]]) {
    const value = autonomyFixture();
    value.quota = { checkpoint_remaining_percent: checkpoint, stop_new_remaining_percent: stop };
    assert.deepEqual(autonomyDiagnostics(value), { valid: false, codes: ['autonomy_schema_invalid'] });
  }
  for (const [checkpoint, stop] of [[30, 30], [31, 30]]) {
    const value = autonomyFixture();
    value.quota = { checkpoint_remaining_percent: checkpoint, stop_new_remaining_percent: stop };
    assert.deepEqual(autonomyDiagnostics(value), { valid: false, codes: ['autonomy_threshold_order'] });
  }
  const parallel = autonomyFixture(); parallel.limits.issues = 1; parallel.limits.parallel_issues = 2;
  assert.deepEqual(autonomyDiagnostics(parallel), { valid: false, codes: ['autonomy_parallel_limit'] });
  parallel.quota.checkpoint_remaining_percent = 30;
  assert.deepEqual(autonomyDiagnostics(parallel), { valid: false, codes: ['autonomy_threshold_order', 'autonomy_parallel_limit'] });
});

test('autonomy parser rejects malformed YAML, duplicate keys, aliases and tags with safe errors', () => {
  for (const text of ['limits: [', 'revision: 1\nrevision: 2', 'x: &a [1]\ny: *a', 'x: !private credential-sentinel', 'x: !!str credential-sentinel']) {
    assert.throws(() => parseAutonomyYaml(text), { message: 'autonomy_yaml_invalid' });
  }
  assert.throws(() => parseAutonomyYaml('x'.repeat(16385)), { message: 'autonomy_yaml_invalid' });
  assert.equal(autonomyDiagnostics(parseAutonomyYaml(JSON.stringify(autonomyFixture()))).valid, true);
});

test('autonomy configured file check is offline, fails closed and never prints private values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'autonomy-probe-'));
  try {
    for (const mode of ['valid', 'changed', 'missing', 'invalid', 'not-file']) {
      const preload = join(dir, mode + '.mjs');
      // Probe only the real fixed-file check, in a child, without modifying this repository.
      writeFileSync(preload, `import fs from 'node:fs';import http from 'node:http';import https from 'node:https';import net from 'node:net';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const read=fs.readFileSync,stat=fs.lstatSync;const fixed=p=>String(p).replaceAll('\\\\','/').endsWith('/.ai-workflow/autonomy.yaml');
fs.readFileSync=(p,...args)=>{if(fixed(p)){if('${mode}'==='missing')throw Error('private-path-sentinel');const text='${mode}'==='invalid'?'private: credential-sentinel':'${mode}'==='changed'?${JSON.stringify(JSON.stringify({ ...autonomyFixture(), limits: { issues: 3, minutes: 90, parallel_issues: 2, repair_rounds: 1 } }))}:null;if(text!==null)return typeof args[0]==='string'||args[0]?.encoding?text:Buffer.from(text);}return read(p,...args);};
fs.lstatSync=(p,...args)=>fixed(p)&&'${mode}'==='not-file'?{isFile:()=>false}:stat(p,...args);
const deny=()=>{throw Error('external_operation_forbidden')};for(const m of [http,https,net,cp])for(const k of ['request','get','connect','createConnection','exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'])if(typeof m[k]==='function')m[k]=deny;
for(const k of ['writeFileSync','appendFileSync','renameSync','unlinkSync','mkdirSync'])fs[k]=deny;globalThis.fetch=deny;syncBuiltinESMExports();`);
      const r = spawnSync(process.execPath, ['--import', preload, '--test-name-pattern=^autonomy configured file is valid', fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 15000, maxBuffer: 128 * 1024 });
      assert.equal(r.error, undefined, 'probe_process_failed');
      assert.equal(r.status, ['valid', 'changed'].includes(mode) ? 0 : 1, 'probe_status_invalid');
      assert.equal((r.stdout + r.stderr).includes('credential-sentinel'), false);
      assert.equal((r.stdout + r.stderr).includes('private-path-sentinel'), false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
