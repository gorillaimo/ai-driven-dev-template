import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { messages } from './messages.mjs';

const root = new URL('../../', import.meta.url);
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(JSON.parse(readFileSync(
  new URL('.ai-workflow/schemas/issue/v1/common.schema.json', root), 'utf8')));
for (const kind of ['rule', 'context', 'resolution']) {
  ajv.addSchema(JSON.parse(readFileSync(
    new URL('.ai-workflow/schemas/rules/v1/' + kind + '.schema.json', root), 'utf8')));
}
const validators = Object.fromEntries(['rule', 'context', 'resolution'].map(kind =>
  [kind, ajv.getSchema('urn:ai-workflow:rules:v1:' + kind)]));
const optValidator = ajv.getSchema('urn:ai-workflow:rules:v1:context#/$defs/optIn');

export const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const digest = value => createHash('sha256').update(value).digest('hex');
const safeFile = path => typeof path === 'string' &&
  /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path);
const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort(compare)
      .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function validateArtifact(kind, value) {
  const validate = validators[kind];
  if (!validate) throw new Error('Unknown artifact');
  const valid = validate(value);
  const errors = (validate.errors ?? [])
    .map(({ instancePath, keyword, schemaPath }) => ({ instancePath, keyword, schemaPath }))
    .sort((a, b) => compare(canonical(a), canonical(b)));
  return { valid, errors };
}

function normalize(input) {
  const sort = values => [...values].sort((a, b) => compare(canonical(a), canonical(b)));
  return {
    rules: sort(input.rules ?? []),
    context: input.context ?? null,
    optIns: sort(input.optIns ?? []),
    sourceDigests: input.sourceDigests ?? {},
    ruleSources: input.ruleSources ?? {},
  };
}

function conditionValues(rule, context) {
  return rule.applies_when.map(condition => {
    const fact = context?.[condition.fact];
    if (fact === undefined) return 'unknown';
    return (Array.isArray(fact) ? fact : [fact])
      .some(value => condition.any_of.includes(value)) ? 'true' : 'false';
  });
}

function checkCycles(graph, fail) {
  // Iterative DFS avoids recursion limits on malformed long chains.
  const done = new Set(), active = new Set();
  for (const start of graph.keys()) {
    if (done.has(start)) continue;
    const stack = [{ id: start, index: 0 }];
    active.add(start);
    while (stack.length) {
      const frame = stack.at(-1), edges = graph.get(frame.id) ?? [];
      if (frame.index === edges.length) {
        active.delete(frame.id);
        done.add(frame.id);
        stack.pop();
        continue;
      }
      const next = edges[frame.index++];
      if (!graph.has(next)) continue;
      if (active.has(next)) {
        const path = stack.slice(stack.findIndex(item => item.id === next)).map(item => item.id);
        for (const id of path) fail(id, 'cycle', path);
      } else if (!done.has(next)) {
        active.add(next);
        stack.push({ id: next, index: 0 });
      }
    }
  }
}

export function resolveRules(input) {
  const normalized = normalize(input);
  const diagnostics = [], records = new Map(), rules = new Map();
  const add = (code, id = null, related = []) => {
    if (!messages[code]) throw new Error('Unknown diagnostic');
    diagnostics.push({ code, rule_id: id, related: [...new Set(related)].sort(compare) });
  };
  const fail = (id, reason, related = []) => {
    const entry = records.get(id);
    if (entry) {
      entry.status = 'conflicted';
      const previous = entry.reasons.filter(value =>
        !['always_on', 'condition_match', 'opt_in'].includes(value));
      entry.reasons = [...new Set([...previous, reason])].sort(compare);
    }
    add(reason, id, related);
  };

  if (!validateArtifact('context', normalized.context).valid) add('invalid_context');
  if (!Object.entries(normalized.sourceDigests)
    .every(([path, value]) => safeFile(path) && validDigest(value))) add('invalid_sources');
  if (!Object.values(normalized.ruleSources).every(safeFile)) add('invalid_sources');

  for (const rule of normalized.rules) {
    if (!validateArtifact('rule', rule).valid) {
      add('invalid_rule', typeof rule?.rule_id === 'string' ? rule.rule_id : null);
      continue;
    }
    const id = rule.rule_id;
    if (rules.has(id)) {
      add('duplicate_rule', id);
      continue;
    }
    rules.set(id, rule);
    records.set(id, {
      rule_id: id, version: rule.version,
      reference: {
        kind: 'file',
        target: safeFile(normalized.ruleSources[id]) ? normalized.ruleSources[id] :
          'docs/common/rules/' + id + '/rule.yaml',
      },
      status: 'selected', reasons: ['always_on'],
    });
  }

  const legacy = rules.get('legacy');
  const legacySources = ['AGENTS.md', 'docs/common/development-rules.md'];
  if (!legacy || legacy.level !== 'always-on' ||
    canonical(legacy.body_refs.map(ref => ref.target).sort(compare)) !== canonical(legacySources) ||
    legacy.body_refs.some(ref => ref.kind !== 'file')) add('legacy_required', 'legacy');

  const opted = new Set();
  for (const opt of normalized.optIns) {
    if (!optValidator(opt)) {
      add('invalid_opt_in', typeof opt?.rule_id === 'string' ? opt.rule_id : null);
      continue;
    }
    if (opted.has(opt.rule_id)) {
      add('invalid_opt_in', opt.rule_id);
      continue;
    }
    opted.add(opt.rule_id);
    const rule = rules.get(opt.rule_id);
    if (!rule) add('unknown_rule', opt.rule_id);
    else if (rule.level !== 'opt-in') add('invalid_opt_in', opt.rule_id);
    else if (rule.version !== opt.version) fail(opt.rule_id, 'dependency_version');
  }

  for (const [id, rule] of rules) {
    const entry = records.get(id);
    if (entry.status === 'conflicted') continue;
    if (rule.level === 'opt-in' && !opted.has(id)) {
      entry.status = 'not_applicable';
      entry.reasons = ['not_opted_in'];
      continue;
    }
    const values = conditionValues(rule, normalized.context);
    if (values.includes('false')) {
      entry.status = 'not_applicable';
      entry.reasons = ['condition_mismatch'];
    } else if (values.includes('unknown')) {
      fail(id, 'unknown_condition');
    } else {
      entry.reasons = [rule.level === 'always-on' ? 'always_on' :
        rule.level === 'opt-in' ? 'opt_in' : 'condition_match'];
    }
  }

  // Validate the full declaration graph, including inactive rules.
  const graph = new Map([...rules].map(([id, rule]) => [id,
    [...new Set([...rule.requires.map(dep => dep.rule_id), ...rule.after])].sort(compare)]));
  for (const [id, rule] of rules) {
    for (const dep of [...graph.get(id), ...rule.conflicts_with]) {
      if (!rules.has(dep)) fail(id, 'unknown_rule', [dep]);
    }
    for (const dep of rule.requires) {
      if (rules.has(dep.rule_id) && rules.get(dep.rule_id).version !== dep.version) {
        fail(id, 'dependency_version', [dep.rule_id]);
      }
    }
    if (rule.conflicts_with.includes(id)) fail(id, 'rule_conflict', [id]);
  }
  checkCycles(graph, fail);

  const candidates = new Set([...records].filter(([, entry]) => entry.status === 'selected')
    .map(([id]) => id));
  for (const [id, rule] of rules) {
    if (!candidates.has(id)) continue;
    for (const other of rule.conflicts_with) {
      if (!candidates.has(other)) continue;
      fail(id, 'rule_conflict', [other]);
      if (other !== id) fail(other, 'rule_conflict', [id]);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, rule] of rules) {
      if (records.get(id).status !== 'selected') continue;
      for (const dep of rule.requires) {
        if (records.get(dep.rule_id)?.status === 'selected') continue;
        fail(id, 'dependency_not_selected', [dep.rule_id]);
        changed = true;
        break;
      }
    }
  }

  // Topological order is execution order only, never permission to relax authority.
  const order = [], selected = new Set([...records]
    .filter(([, entry]) => entry.status === 'selected').map(([id]) => id));
  const rank = { 'always-on': 0, conditional: 1, 'opt-in': 2 };
  while (!diagnostics.length && selected.size) {
    const ready = [...selected].filter(id => graph.get(id).every(dep => !selected.has(dep)))
      .sort((a, b) => rank[rules.get(a).level] - rank[rules.get(b).level] || compare(a, b));
    if (!ready.length) {
      add('cycle');
      break;
    }
    order.push(ready[0]);
    selected.delete(ready[0]);
  }

  const result = {
    schema_version: 1, resolver_version: '1.0.0',
    status: diagnostics.length ? 'blocked' : 'pass',
    context: structuredClone(normalized.context),
    opt_ins: structuredClone(normalized.optIns),
    input_digest: digest(canonical(normalized)),
    source_digests: Object.fromEntries(Object.entries(normalized.sourceDigests)
      .filter(([path, value]) => safeFile(path) && validDigest(value))),
    rules: [...records.values()].sort((a, b) => compare(a.rule_id, b.rule_id)),
    order: diagnostics.length ? [] : order,
    diagnostics: [...new Map(diagnostics.map(item => [canonical(item), item])).values()]
      .sort((a, b) => compare(canonical(a), canonical(b))),
  };
  if (!validateArtifact('resolution', result).valid) throw new Error('Invalid resolution output');
  return result;
}
