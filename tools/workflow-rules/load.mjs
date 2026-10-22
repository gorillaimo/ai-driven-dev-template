import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { parseDocument, visit } from 'yaml';
import { digest, validateArtifact, compare } from './resolve.mjs';

const MAX_BYTES = 1024 * 1024;
const standardTags = ['str', 'int', 'bool', 'null', 'float', 'map', 'seq']
  .map(tag => 'tag:yaml.org,2002:' + tag);

export function parseYaml(text) {
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('yaml_size');
  const document = parseDocument(text, { version: '1.2', uniqueKeys: true });
  if (document.errors.length || document.warnings.length) throw new Error('yaml_invalid');
  visit(document, {
    Alias() { throw new Error('yaml_alias'); },
    Node(_key, node) {
      if (node.tag && !standardTags.includes(node.tag)) throw new Error('yaml_tag');
    },
  });
  return document.toJS({ maxAliasCount: 0 });
}

function safePath(root, path) {
  if (typeof path !== 'string' ||
    !/^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path)) {
    throw new Error('unsafe_path');
  }
  const base = realpathSync(root), target = resolve(base, path), rel = relative(base, target);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('unsafe_path');
  let part = base;
  for (const segment of rel.split(sep)) {
    part = resolve(part, segment);
    if (lstatSync(part).isSymbolicLink()) throw new Error('symlink');
  }
  return target;
}

export function readLocal(root, path) {
  const target = safePath(root, path), stat = lstatSync(target);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('invalid_file');
  return readFileSync(target, 'utf8');
}

export function loadRules(root) {
  const rules = [], sourceDigests = Object.create(null), ruleSources = Object.create(null);
  for (const dir of ['docs/common/rules', '.ai-workflow/rules']) {
    let folders;
    try {
      folders = readdirSync(safePath(root, dir), { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const folder of folders.sort((a, b) => compare(a.name, b.name))) {
      if (!folder.isDirectory() || folder.isSymbolicLink()) throw new Error('invalid_rule_directory');
      const metadata = dir + '/' + folder.name + '/rule.yaml';
      const body = dir + '/' + folder.name + '/rule.md';
      const rule = parseYaml(readLocal(root, metadata));
      if (!validateArtifact('rule', rule).valid || rule.rule_id !== folder.name) {
        throw new Error('invalid_rule');
      }
      for (const path of [metadata, body, ...rule.body_refs.map(ref => ref.target)]) {
        sourceDigests[path] = digest(readLocal(root, path));
      }
      // Legacy's wrapper refers to the original two documents instead of copying them.
      if (rule.rule_id !== 'legacy' && !rule.body_refs.some(ref => ref.target === body)) {
        throw new Error('missing_rule_body');
      }
      if (ruleSources[rule.rule_id]) throw new Error('duplicate_rule');
      ruleSources[rule.rule_id] = metadata;
      rules.push(rule);
    }
  }
  const legacy = rules.find(rule => rule.rule_id === 'legacy');
  if (!legacy || ruleSources.legacy !== 'docs/common/rules/legacy/rule.yaml') {
    throw new Error('legacy_required');
  }
  return { rules, sourceDigests, ruleSources };
}
