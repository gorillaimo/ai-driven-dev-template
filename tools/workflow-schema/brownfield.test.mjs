// Tests for bundled synthetic examples only. This is not an application analyzer or approval validator.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parseDocument, visit } from 'yaml';

const root = new URL('../../', import.meta.url);
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);
for (const name of ['common','brownfield']) {
  const schema = JSON.parse(readFileSync(new URL('.ai-workflow/schemas/issue/v1/' + name + '.schema.json', root), 'utf8'));
  assert.equal(ajv.validateSchema(schema), true);
  ajv.addSchema(schema);
}
const validate = ajv.getSchema('urn:ai-workflow:issue:v1:brownfield');
const read = path => readFileSync(new URL(path, root), 'utf8');
function parse(text) {
  const doc = parseDocument(text, { version: '1.2', uniqueKeys: true });
  if (doc.errors.length || doc.warnings.length) throw new Error('yaml');
  visit(doc, { Alias() { throw new Error('yaml'); } });
  return doc.toJS({ maxAliasCount: 0 });
}
function assertExample(value) {
  assert.equal(validate(value), true, 'schema: ' + JSON.stringify(validate.errors?.map(({keyword,instancePath})=>({keyword,instancePath}))));
  const review = value.extensions?.brownfield_review;
  assert.equal(review?.mode, 'read_only');
  assert.equal(review.command_policy, 'record_only');
  assert.match(review.baseline.commit, /^[a-f0-9]{40}$/);
  for (const value of Object.values(review.limits)) assert.ok(Number.isInteger(value) && value > 0, 'limits: positive integer required');
  assert.ok(['not_required','pending','recorded'].includes(review.approval.status), 'approval: unknown status');
  assert.ok(review.stop_conditions.length > 0);
  assert.equal(review.approval.status === 'recorded', review.approval.reference !== null);
  if (review.approval.status === 'recorded') {
    assert.ok(review.approval.approved_by && review.approval.approved_at);
  } else {
    assert.equal(review.approval.approved_by, null);
    assert.equal(review.approval.approved_at, null);
  }
  if (value.depth === 'high' && review.approval.status !== 'recorded') {
    assert.equal(value.status, 'blocked', 'approval: High must wait');
    assert.equal(value.components.length, 0, 'approval: no High analysis before approval');
    assert.equal(value.flows.length, 0, 'approval: no High analysis before approval');
  }
  if (value.status === 'complete') {
    assert.deepEqual(value.unknowns, [], 'complete: required observations remain unknown');
    assert.deepEqual(value.unanalysed, [], 'complete: required scope remains unanalysed');
  } else {
    assert.ok(value.unknowns.length || value.unanalysed.length, 'incomplete: explain missing observations');
    assert.ok(value.follow_up.length, 'incomplete: preserve handoff');
  }
  const ids = new Set(value.components.map(c=>c.component_id));
  assert.equal(ids.size, value.components.length, 'component: duplicate ID');
  for (const c of value.components) for (const id of c.depends_on) assert.ok(ids.has(id), 'component: unknown dependency');
  for (const flow of value.flows) {
    assert.ok(flow.evidence.length, 'flow: evidence required');
    for (const id of flow.components) assert.ok(ids.has(id), 'component: unknown flow member');
  }
  for (const command of value.commands) {
    assert.ok(command.evidence.length && command.side_effects.trim());
    if (command.status === 'verified') assert.ok((review.command_verifications ?? []).some(v =>
      v.command === command.command && v.baseline_commit === review.baseline.commit && v.reference && v.conditions), 'verified: prior verification evidence required');
  }
  for (const setting of value.settings) assert.deepEqual(Object.keys(setting).sort(), ['location','name']);
}

for (const [depth, status] of [['low','partial'],['medium','partial'],['high','blocked']]) {
  test('template: ' + depth, () => {
    const prefix = '.ai-workflow/templates/brownfield/v1/' + depth + '/';
    const value = parse(read(prefix + 'brownfield.yaml'));
    const before = JSON.stringify(value);
    assertExample(value); assertExample(value);
    assert.equal(value.depth, depth); assert.equal(value.status, status);
    assert.equal(JSON.stringify(value), before);
    const md = read(prefix + 'brownfield.md');
    assert.match(md, /\]\(brownfield\.yaml\)/);
    assert.match(md, /合成/);
    assert.match(md, /unknowns|未確認/);
    assert.match(md, /baseline|基準/);
  });
}
for (const status of ['complete','partial','blocked']) {
  test('status example: ' + status, () => {
    const value = parse(read('tests/workflow-brownfield/fixtures/' + status + '.yaml'));
    assert.equal(value.status, status); assertExample(value);
  });
}
test('case manifest has unique IDs and lists each fixture', () => {
  const cases = JSON.parse(read('tests/workflow-brownfield/cases.json'));
  assert.equal(new Set(cases.map(c=>c.id)).size, cases.length);
  for (const file of readdirSync(new URL('tests/workflow-brownfield/fixtures/', root))) {
    assert.ok(cases.some(c=>c.file===file), 'Unlisted fixture: ' + file);
  }
});
const cases = JSON.parse(read('tests/workflow-brownfield/cases.json'));
for (const c of cases) test(c.id, () => {
  const run = () => {
    const value = parse(read('tests/workflow-brownfield/fixtures/' + c.file));
    for (const change of c.changes ?? []) {
      const parent = change.path.slice(0,-1).reduce((node,key)=>node[key],value);
      if (change.remove) delete parent[change.path.at(-1)];
      else parent[change.path.at(-1)] = structuredClone(change.value);
    }
    assertExample(value);
  };
  if (c.valid) run(); else assert.throws(run, new RegExp(c.error));
});
test('command text is data and is never executed by the example tests', () => {
  const directory = mkdtempSync(join(tmpdir(),'brownfield-record-'));
  try {
    const value = parse(read('tests/workflow-brownfield/fixtures/complete.yaml'));
    const marker = join(directory,'must-not-exist');
    value.commands[0].command = 'touch ' + marker;
    assertExample(value);
    assert.equal(existsSync(marker),false);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test('template links resolve to the paired YAML and shared guide', () => {
  for (const depth of ['low','medium','high']) {
    const mdUrl = new URL('.ai-workflow/templates/brownfield/v1/' + depth + '/brownfield.md', root);
    const md = readFileSync(mdUrl,'utf8');
    for (const match of md.matchAll(/\]\(([^)]+)\)/g)) assert.equal(existsSync(new URL(match[1],mdUrl)),true,'Broken template link');
  }
});
