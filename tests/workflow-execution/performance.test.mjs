import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('bounded large cold input completes in ten seconds (environment measurement)',()=>{
 const child=spawnSync(process.execPath,['--input-type=module','-e',`
 const start=performance.now();
 const {checkExecutionEvidence}=await import('./tools/workflow-execution/check.mjs');
 const {largeFixture}=await import('./tests/workflow-execution/limits-fixture.mjs');
 const input=largeFixture(),bytes=Buffer.byteLength(JSON.stringify(input)),result=checkExecutionEvidence(input);
 console.log(JSON.stringify({status:result.status,bytes,ms:performance.now()-start,diagnostics:result.diagnostics}));
 `],{cwd:new URL('../../',import.meta.url),timeout:10000,encoding:'utf8'});
 assert.ifError(child.error);assert.equal(child.status,0,child.stderr);const r=JSON.parse(child.stdout);assert.equal(r.status,'pass',JSON.stringify(r));assert.ok(r.bytes<5*1024*1024);assert.ok(r.ms<10000);console.log('execution bounded cold: '+Math.round(r.ms)+' ms, '+r.bytes+' bytes');
});
