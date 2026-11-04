import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, sep } from 'node:path';

// Resolve from each tool's Ajv, so a different tool's patched copy cannot hide a regression.
for (const name of ['schema', 'rules', 'check', 'trace', 'golden', 'ci']) {
  const tool = new URL('../../tools/workflow-' + name + '/', import.meta.url);
  const require = createRequire(new URL('package.json', tool));
  const fromAjv = createRequire(require.resolve('ajv/package.json'));
  const manifest = fromAjv.resolve('fast-uri/package.json');
  const lock = JSON.parse(readFileSync(new URL('package-lock.json', tool), 'utf8'));
  const installed = JSON.parse(readFileSync(manifest, 'utf8'));
  const dependencyPath = relative(realpathSync(tool), dirname(realpathSync(manifest))).split(sep).join('/');
  assert.ok(dependencyPath.startsWith('node_modules/'), name + ': dependency must belong to this tool');
  assert.equal(installed.version, lock.packages[dependencyPath]?.version, name + ': installed dependency must match its lock');
  const uri = fromAjv('fast-uri');

  // Public advisory inputs are parsed as strings only; no URL or script is executed.
  test(name + ': encoded schemes cannot become valid schemes (GHSA-w74x-v6f9-j3xg)', () => {
    const encoded = 'ht%74ps://example.invalid/';
    assert.ok(uri.parse(encoded).error);
    assert.equal(uri.normalize(encoded), encoded);
    assert.equal(uri.equal(encoded, 'https://example.invalid/'), false);
    assert.throws(() => uri.resolve('https://example.invalid/base/', encoded));
    assert.equal(uri.parse('https://example.invalid/').error, undefined);
  });

  test(name + ': ambiguous domain hosts are rejected (GHSA-wjr9-j795-jxcr)', () => {
    for (const input of ['http://a@b@example.invalid/', 'http://ex\tample.invalid/']) {
      assert.ok(uri.parse(input).error);
      assert.equal(uri.normalize(input), input);
    }
    assert.equal(uri.parse('https://example.invalid/').host, 'example.invalid');
  });

  test(name + ': relative normalization preserves the resolved target (GHSA-xhq7-xmqj-769h)', () => {
    const base = 'https://example.invalid/a/b/';
    for (const input of ['../x', 'a/../b', 'x/..', './a:b']) {
      assert.equal(uri.resolve(base, uri.normalize(input)), uri.resolve(base, input));
    }
    assert.equal(uri.normalize('../x'), '../x');
    assert.equal(uri.equal('../x', 'x'), false);
    assert.equal(uri.resolve(base, 'child'), 'https://example.invalid/a/b/child');
  });

  test(name + ': suffix paths cannot introduce a scheme (GHSA-333x-w4r6-6crp)', () => {
    const options = { reference: 'suffix', scheme: 'x' };
    const normalized = uri.normalize('javascript:x', options);
    assert.equal(uri.parse(normalized).scheme, undefined);
    assert.equal(uri.normalize('path/to/file', options), 'path/to/file');
    assert.equal(uri.normalize('a/b:c', options), 'a/b:c');
  });
}
