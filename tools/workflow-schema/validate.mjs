import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
