import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { checkProjectPlan, validateArtifact } from '../../tools/workflow-project/check.mjs';
import { loadProjectPlan } from '../../tools/workflow-project/load.mjs';
import { input, feature, bind, clone, ref } from './helpers.mjs';
import { large } from './large.mjs';
import { canonical } from '../../tools/workflow-rules/resolve.mjs';

const block=(i,code)=>{const r=checkProjectPlan(i);assert.equal(r.status,'blocked');assert.deepEqual(r.waves,[]);assert.deepEqual(r.dependency_candidates,[]);assert.equal(validateArtifact('result',r).valid,true);assert.ok(r.diagnostics.some(d=>d.code===code),JSON.stringify(r.diagnostics));return r;};
function temporary(action){const root=mkdtempSync(join(tmpdir(),'project-plan-'));try{return action(root);}finally{rmSync(root,{recursive:true,force:true});}}
function save(root,i){for(const k of ['project','deliveryPlan','context'])writeFileSync(join(root,k+'.json'),JSON.stringify(i[k]));return {project:'project.json',deliveryPlan:'deliveryPlan.json',context:'context.json'};}
test('documented bundled snapshot is a valid example, not real project state',()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),dir='tests/workflow-project/fixtures/';
 const i=loadProjectPlan(root,{project:dir+'project.yaml',deliveryPlan:dir+'delivery-plan.json',context:dir+'context.json'});
 assert.deepEqual(i,input());assert.equal(checkProjectPlan(i).status,'pass');
});
test('loader reads only explicit paths and never changes files',()=>temporary(root=>{
 const i=input(),paths=save(root,i);writeFileSync(join(root,'state.yaml'),'unrelated: !exec BAD');
 const before=['project','deliveryPlan','context'].map(k=>readFileSync(join(root,k+'.json'),'utf8'));
 assert.deepEqual(loadProjectPlan(root,paths),i);assert.equal(checkProjectPlan(loadProjectPlan(root,paths)).status,'pass');
 assert.deepEqual(['project','deliveryPlan','context'].map(k=>readFileSync(join(root,k+'.json'),'utf8')),before);
}));
for(const [name,content] of [['duplicate','a: 1\na: 2'],['alias','a: &a {}\nb: *a'],['tag','a: !exec BAD'],['documents','a: 1\n---\nb: 2']])test('loader rejects YAML '+name,()=>temporary(root=>{
 const paths=save(root,input());writeFileSync(join(root,'context.json'),content);assert.throws(()=>loadProjectPlan(root,paths),e=>/^load_/.test(e.message)&&!e.message.includes('BAD'));
}));
for(const path of ['../escape','/etc/passwd','a/../context.json','a\\context.json','https://evil.example/x'])test('loader rejects unsafe path '+path,()=>temporary(root=>{
 const paths=save(root,input());paths.context=path;assert.throws(()=>loadProjectPlan(root,paths),/^Error: load_/);
}));
test('loader rejects symlinks, directories, missing and oversized files',()=>temporary(root=>{
 const paths=save(root,input());symlinkSync(join(root,'context.json'),join(root,'link.json'));mkdirSync(join(root,'dir'));
 writeFileSync(join(root,'big.json'),' '.repeat(1024*1024+1));
 for(const path of ['link.json','dir','missing','big.json'])assert.throws(()=>loadProjectPlan(root,{...paths,context:path}),/^Error: load_/);
}));
test('loader rejects symlink parent and FIFO without opening them',()=>temporary(root=>{
 const paths=save(root,input());mkdirSync(join(root,'real'));symlinkSync(join(root,'real'),join(root,'link'));
 assert.throws(()=>loadProjectPlan(root,{...paths,context:'link/x.json'}),/^Error: load_/);
 if(process.platform==='linux'){const c=spawnSync('mkfifo',[join(root,'fifo')]);assert.ifError(c.error);assert.equal(c.status,0);assert.throws(()=>loadProjectPlan(root,{...paths,context:'fifo'}),/^Error: load_/);}
}));
test('loader applies aggregate 5 MiB limit across current and previous',()=>temporary(root=>{
 const paths=save(root,input()),text=JSON.stringify({padding:'x'.repeat(900000)});
 const previous={};for(const k of ['project','deliveryPlan','context']){writeFileSync(join(root,k+'.json'),text);writeFileSync(join(root,'old-'+k+'.json'),text);previous[k]='old-'+k+'.json';}
 assert.throws(()=>loadProjectPlan(root,{...paths,previous}),/^Error: load_size/);
}));
test('loader validates path-map keys and previous is read explicitly',()=>temporary(root=>{
 const paths=save(root,input());assert.throws(()=>loadProjectPlan(root,{...paths,command:'BAD'}),/^Error: load_/);
 const r=loadProjectPlan(root,{...paths,previous:paths});assert.deepEqual(r.previous,input());
}));
test('loader rejects accessor paths before reading their values',()=>temporary(root=>{
 const paths=save(root,input());Object.defineProperty(paths,'context',{enumerable:true,get(){throw Error('PRIVATE_CANARY');}});
 assert.throws(()=>loadProjectPlan(root,paths),/^Error: load_paths/);
}));
for(const [name,make] of [
 ['undefined',()=>undefined],['null',()=>null],['array',()=>[]],['function',()=>({f(){}})],['date',()=>new Date()],['nonfinite',()=>({x:Infinity})],['unsafe integer',()=>({x:Number.MAX_SAFE_INTEGER+1})],
 ['cycle',()=>{const i=input();i.loop=i;return i;}],['accessor',()=>{const i=input();Object.defineProperty(i,'bad',{enumerable:true,get(){throw Error('PRIVATE_CANARY');}});return i;}]
])test('non-JSON input '+name+' blocks safely',()=>{const r=checkProjectPlan(make());assert.equal(r.status,'blocked');assert.equal(validateArtifact('result',r).valid,true);assert.ok(!JSON.stringify(r).includes('PRIVATE_CANARY'));});
test('untrusted free text and extensions never appear in diagnostics or execute',()=>{
 const i=input();i.deliveryPlan.features[0].depends_on=[{feature_id:'missing',reason:'PRIVATE_CANARY'}];i.project.extensions={command:'PRIVATE_CANARY',nested:{secret:'PRIVATE_CANARY'}};bind(i);
 const r=block(i,'unknown_dependency');assert.ok(!JSON.stringify(r).includes('PRIVATE_CANARY'));
});
test('schema errors do not expose attacker-controlled property names',()=>{const i=input();i.context.PRIVATE_CANARY='secret';const r=block(i,'schema_invalid');assert.ok(!JSON.stringify(r).includes('PRIVATE_CANARY'));});
test('arbitrary JSON extension numbers remain data and cannot relax constraints',()=>{
 const i=input();i.project.extensions={measurement:0.5,disabled:true};bind(i);assert.equal(checkProjectPlan(i).status,'pass');
});
test('nonstandard array prototype is not JSON and cannot run input code',()=>{
 const i=input(),prototype=Object.create(Array.prototype);prototype.entries=()=>{throw Error('PRIVATE_CANARY');};Object.setPrototypeOf(i.deliveryPlan.features,prototype);
 const r=checkProjectPlan(i);assert.equal(r.status,'blocked');assert.ok(!JSON.stringify(r).includes('PRIVATE_CANARY'));
});
test('5 MiB canonical input is accepted and the next byte is rejected',()=>{
 const i=input();i.project.extensions={text:''};bind(i);const remaining=5*1024*1024-Buffer.byteLength(canonical(i));i.project.extensions.text='x'.repeat(remaining);bind(i);
 assert.equal(Buffer.byteLength(canonical(i)),5*1024*1024);assert.equal(checkProjectPlan(i).status,'pass');i.project.extensions.text+='x';block(i,'input_limit');
});
test('depth 32 is accepted and depth 33 is blocked',()=>{
 const i=input();let v={};i.project.extensions=v;for(let n=0;n<30;n++)v=v.child={};bind(i);assert.equal(checkProjectPlan(i).status,'pass');v.child={};block(i,'input_limit');
});
test('a normal file at exactly 1 MiB is accepted',()=>temporary(root=>{
 const i=input(),paths=save(root,i),file=join(root,'project.json'),raw=readFileSync(file,'utf8');writeFileSync(file,raw+' '.repeat(1024*1024-Buffer.byteLength(raw)));
 assert.equal(checkProjectPlan(loadProjectPlan(root,paths)).status,'pass');
}));
test('large cycle diagnostics stop within the output budget',()=>{
 const fs=Array.from({length:1000},(_,n)=>feature('f'+String(n).padStart(4,'0')+'x'.repeat(120),n?[('f'+String(n-1).padStart(4,'0')+'x'.repeat(120))]:[]));
 for(let n=0;n<30;n++)fs[n].depends_on.push({feature_id:fs[999].feature_id,reason:'Contract.'});
 const r=block(input(fs),'output_limit');assert.ok(Buffer.byteLength(JSON.stringify(r))<=1024*1024);
});
for(const [name,change] of [
 ['features',i=>{i.deliveryPlan.features=Array.from({length:1001},(_,n)=>feature('n'+n));}],
 ['areas',i=>{i.project.areas=Array.from({length:201},(_,n)=>({area_id:'a'+n,paths:['a'+n],shared:false,integration_owner:null,conflict_policy:'serialize'}));}],
 ['edges',i=>{i.deliveryPlan.features[0].depends_on=Array.from({length:10001},(_,n)=>({feature_id:'n'+n,reason:'Contract.'}));}],
 ['constraints',i=>{i.deliveryPlan.features[0].constraints=Array.from({length:10001},()=>({kind:'approval',reference:clone(ref),reason:'Review.'}));}],
 ['history',i=>{i.deliveryPlan.revision_history=Array(101).fill({});}],
 ['depth',i=>{let v={};i.project.extensions=v;for(let n=0;n<34;n++)v=v.child={};}],
 ['bytes',i=>{i.project.extensions={text:'x'.repeat(5*1024*1024)};}],
])test('bounded input '+name,()=>{const i=input();change(i);block(i,'input_limit');});
test('diagnostics cap blocks instead of returning partial executable waves',()=>{
 const i=input();i.deliveryPlan.features[0].depends_on=Array.from({length:1001},(_,n)=>({feature_id:'missing'+n,reason:'Contract.'}));bind(i);
 const r=block(i,'diagnostic_limit');assert.ok(r.diagnostics.length<=1000);assert.ok(Buffer.byteLength(JSON.stringify(r))<=1024*1024);
});
test('maximum graph has exactly 1000 features/10000 edges and no recursive overflow',()=>{
 const i=large();assert.equal(i.deliveryPlan.features.length,1000);assert.equal(i.deliveryPlan.features.reduce((n,f)=>n+f.depends_on.length,0),10000);
 const start=performance.now(),r=checkProjectPlan(i);assert.equal(r.status,'pass');assert.equal(r.waves.length,1000);assert.ok(performance.now()-start<5000);
});
if(!process.env.PROJECT_PLAN_CHILD)test('cold maximum graph is offline and finishes within 5 seconds',()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const script=`import {checkProjectPlan} from './tools/workflow-project/check.mjs';import {large} from './tests/workflow-project/large.mjs';const r=checkProjectPlan(large());if(r.status!=='pass'||r.waves.length!==1000)process.exit(1);console.log('max-graph-pass');`;
 const start=performance.now(),c=spawnSync(process.execPath,['--import','./tests/workflow-project/offline.mjs','--input-type=module','-e',script],{cwd:root,env:{...process.env,PROJECT_PLAN_CHILD:'1'},timeout:5000,encoding:'utf8'});
 assert.ifError(c.error);assert.equal(c.status,0,c.stderr);assert.equal(c.stdout.trim(),'max-graph-pass');assert.ok(performance.now()-start<5000);
});
test('CI connects only the new package install/test and keeps the previous boundaries',()=>{
 const ci=readFileSync(new URL('../../.github/workflows/workflow-validation.yml',import.meta.url),'utf8');
 assert.ok(ci.includes('npm ci --prefix tools/workflow-project --ignore-scripts --no-audit --no-fund'));assert.ok(ci.includes('npm test --prefix tools/workflow-project'));
 const runner=readFileSync(new URL('../../tools/workflow-ci/validate.mjs',import.meta.url),'utf8');assert.ok(!runner.includes('workflow-project'));
});
