import test from 'node:test';
import assert from 'node:assert/strict';
import { checkExecutionEvidence as check } from '../../tools/workflow-execution/check.mjs';
import { validateExecutionArtifact as validate } from '../../tools/workflow-execution/schema.mjs';
import { fixture } from './fixture.mjs';
for(const [name,make] of [['cycle',()=>{const x={};x.x=x;return x;}],['nan',()=>NaN],['infinity',()=>Infinity],['date',()=>new Date()],['sparse',()=>Array(2)],['symbol',()=>({[Symbol()]:1})],['function',()=>({x(){}})],['proxy',()=>new Proxy({},{ownKeys(){throw Error('canary');}})],['accessor',()=>Object.defineProperty({},'x',{enumerable:true,get(){throw Error('canary');}})]])test('bounded data only: '+name,()=>{const x=make();assert.equal(check(x).status,'blocked');assert.equal(validate('profile',x).valid,false);});
test('getter is never invoked and invalid key/value cannot leak',()=>{let called=false;const x={};Object.defineProperty(x,'CANARY_SECRET',{enumerable:true,get(){called=true;throw Error('CANARY_SECRET');}});assert.ok(!JSON.stringify(check(x)).includes('CANARY_SECRET'));assert.equal(called,false);const s=fixture();s.context['CANARY_SECRET']='RAW_COMMAND_SECRET';assert.ok(!/CANARY_SECRET|RAW_COMMAND_SECRET/.test(JSON.stringify(check(s))));});
test('deep/large input is blocked without recursion overflow',()=>{let x={};for(let i=0;i<40;i++)x={x};assert.equal(check(x).status,'blocked');assert.equal(check({text:'x'.repeat(5*1024*1024)}).status,'blocked');});
test('artifact/event/selected count bounds cannot produce pass',()=>{for(const change of [s=>s.events=Array(10001).fill({}),s=>s.verifications=Array(129).fill(s.verifications[0]),s=>s.grant.selected=Array(101).fill(s.grant.selected[0])]){const s=fixture();change(s);assert.equal(check(s).status,'blocked');}});
test('diagnostics and output have hard bounds',()=>{const s=fixture();s.context.facts=Array.from({length:1000},(_,i)=>({fact_id:'fact-'+i,value:'unknown',observed_at:s.context.evaluated_at,evidence_refs:[]}));const r=check(s);assert.equal(r.status,'blocked');assert.ok(r.diagnostics.length<=1000);assert.ok(Buffer.byteLength(JSON.stringify(r))<=1024*1024);});
test('checker and loader operate with network/process/write functions denied',async()=>{
 const {spawnSync}=await import('node:child_process');const r=spawnSync(process.execPath,['tests/workflow-execution/no-side-effects.mjs'],{cwd:new URL('../../',import.meta.url),encoding:'utf8',timeout:10000});assert.ifError(r.error);assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'read_only_pass');
});
