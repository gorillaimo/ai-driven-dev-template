import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdtempSync,rmSync,symlinkSync,mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { checkProjectMembers } from '../../tools/workflow-project/members.mjs';
import { validateMemberArtifact } from '../../tools/workflow-project/member-schema.mjs';
import { loadProjectMembers } from '../../tools/workflow-project/member-load.mjs';
import { input,bind,clone,member,claim,ref } from './helpers.mjs';
import { large } from './large.mjs';
import { blocked } from './members.test.mjs';
const temporary=fn=>{const root=mkdtempSync(join(tmpdir(),'member-check-'));try{return fn(root);}finally{rmSync(root,{recursive:true,force:true});}};
const save=(root,i)=>{for(const k of ['project','team','context'])writeFileSync(join(root,k+'.json'),JSON.stringify(i[k]));return {project:'project.json',team:'team.json',context:'context.json'};};
test('bundled documented JSON snapshots are coherent synthetic inputs',()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),dir='tests/workflow-members/fixtures/';
 const i=loadProjectMembers(root,{project:dir+'project.json',team:dir+'team.json',context:dir+'context.json'});assert.deepEqual(i,input());assert.equal(checkProjectMembers(i).status,'pass');
});
test('loader reads only explicit normal files and does not change them',()=>temporary(root=>{
 const i=input(),paths=save(root,i),before=Object.values(paths).map(p=>readFileSync(join(root,p),'utf8'));writeFileSync(join(root,'unrelated.yaml'),'x: !command PRIVATE_CANARY');
 assert.deepEqual(loadProjectMembers(root,paths),i);assert.equal(checkProjectMembers(loadProjectMembers(root,paths)).status,'pass');assert.deepEqual(Object.values(paths).map(p=>readFileSync(join(root,p),'utf8')),before);
}));
for(const [name,raw] of [['duplicate','a: 1\na: 2'],['alias','a: &a {}\nb: *a'],['tag','a: !command PRIVATE_CANARY'],['multi','a: 1\n---\nb: 2']])test('strict YAML '+name,()=>temporary(root=>{
 const paths=save(root,input());writeFileSync(join(root,'context.json'),raw);assert.throws(()=>loadProjectMembers(root,paths),/^Error: load_/);
}));
for(const p of ['../x','/etc/passwd','a/../x','a\\x','https://evil.example/x'])test('unsafe path '+p,()=>temporary(root=>{const paths=save(root,input());assert.throws(()=>loadProjectMembers(root,{...paths,context:p}),/^Error: load_/);}));
test('symlinks, missing/directory/FIFO and oversized files are rejected',()=>temporary(root=>{
 const paths=save(root,input());symlinkSync(join(root,'context.json'),join(root,'link'));mkdirSync(join(root,'dir'));symlinkSync(join(root,'dir'),join(root,'linkdir'));writeFileSync(join(root,'big'),' '.repeat(1024*1024+1));
 for(const p of ['link','missing','dir','linkdir/x','big'])assert.throws(()=>loadProjectMembers(root,{...paths,context:p}),/^Error: load_/);
 if(process.platform==='linux'){const r=spawnSync('mkfifo',[join(root,'fifo')]);assert.ifError(r.error);assert.equal(r.status,0);assert.throws(()=>loadProjectMembers(root,{...paths,context:'fifo'}),/^Error: load_/);}
}));
test('path-map keys and accessors cannot invoke input code',()=>temporary(root=>{
 const paths=save(root,input());assert.throws(()=>loadProjectMembers(root,{...paths,command:'BAD'}),/^Error: load_paths/);
 Object.defineProperty(paths,'context',{enumerable:true,get(){throw Error('PRIVATE_CANARY');}});assert.throws(()=>loadProjectMembers(root,paths),/^Error: load_paths/);
}));
for(const [name,make] of [
 ['undefined',()=>undefined],['null',()=>null],['function',()=>({command(){throw Error('PRIVATE_CANARY');}})],['date',()=>new Date()],['NaN',()=>({x:NaN})],
 ['cycle',()=>{const i=input();i.context.loop=i;return i;}],['accessor',()=>{const i=input();Object.defineProperty(i,'trap',{enumerable:true,get(){throw Error('PRIVATE_CANARY');}});return i;}],
 ['array prototype',()=>{const i=input();const p=Object.create(Array.prototype);p.entries=()=>{throw Error('PRIVATE_CANARY');};Object.setPrototypeOf(i.team.members,p);return i;}]
])test('non JSON '+name,()=>{const r=checkProjectMembers(make());assert.equal(r.status,'blocked');assert.equal(r.subject.qualification,'unknown');assert.equal(validateMemberArtifact('result',r).valid,true);assert.ok(!JSON.stringify(r).includes('PRIVATE_CANARY'));});
test('extensions are inert data and are not exposed by diagnostics',()=>{
 const i=input();i.project.extensions={skip_membership:true,secret:'PRIVATE_CANARY',command:'PRIVATE_CANARY',measurement:0.5};i.context.member_facts[0].repository_access={state:'unknown',permission:null};bind(i);
 const r=blocked(i,'permission_unknown');assert.ok(!JSON.stringify(r).includes('PRIVATE_CANARY'));
});
for(const [name,change] of [
 ['members',i=>i.team.members=Array.from({length:1001},(_,n)=>member('m-'+n))],
 ['facts',i=>i.context.member_facts=Array(1001).fill(i.context.member_facts[0])],
 ['areas',i=>i.project.areas=Array(201).fill(i.project.areas[0])],
 ['claims',i=>i.context.active_claims=Array(10001).fill(claim())],
 ['references',i=>i.team.members[0].areas=Array(10001).fill('backend')],
 ['depth',i=>{let o={};i.project.extensions=o;for(let n=0;n<34;n++)o=o.child={};}],
 ['bytes',i=>i.project.extensions={text:'x'.repeat(5*1024*1024)}],
])test('input upper bound '+name,()=>{const i=input();change(i);blocked(i,'input_limit');});
test('excessive diagnostics are capped and never produce eligible output',()=>{
 const i=input();i.team.members.push(...Array.from({length:999},()=>({...clone(i.team.members[0]),areas:['missing','other']})));i.team.members.splice(1000);
 bind(i);const r=blocked(i,'diagnostic_limit');assert.ok(r.diagnostics.length<=1000);assert.ok(Buffer.byteLength(JSON.stringify(r))<=1024*1024);
});
test('a normal input file at exactly 1 MiB is accepted',()=>temporary(root=>{
 const i=input(),paths=save(root,i),p=join(root,'project.json'),raw=readFileSync(p,'utf8');writeFileSync(p,raw+' '.repeat(1024*1024-Buffer.byteLength(raw)));
 assert.equal(checkProjectMembers(loadProjectMembers(root,paths)).status,'pass');
}));
test('JSON depth boundary is enforced before schema interpretation',()=>{
 const i=input();let o={};i.project.extensions=o;for(let n=0;n<30;n++)o=o.child={};bind(i);assert.equal(checkProjectMembers(i).status,'pass');o.child={};blocked(i,'input_limit');
});
test('unknown result fields and versions are rejected by the new contract',()=>{
 for(const mutate of [r=>r.schema_version=2,r=>r.assignee='alice',r=>r.status='authorized']){const r=checkProjectMembers(input());mutate(r);assert.equal(validateMemberArtifact('result',r).valid,false);}
});
test('freshness limit cannot exceed a day or be zero',()=>{for(const n of [0,86401]){const i=input();i.context.freshness_limit_seconds=n;blocked(i,'schema_invalid');}});
test('largest representative input remains bounded and does not recurse',()=>{
 const i=large();assert.equal(i.team.members.length,1000);assert.equal(i.project.areas.length,200);assert.equal(i.context.active_claims.length,10000);
 const start=performance.now(),r=checkProjectMembers(i);assert.equal(r.status,'pass');assert.equal(r.capacity.active_count,10000);assert.ok(performance.now()-start<5000);
});
test('cold max input runs without external calls and within 5 seconds',()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),code=`import {checkProjectMembers} from './tools/workflow-project/members.mjs';import {large} from './tests/workflow-members/large.mjs';const r=checkProjectMembers(large());if(r.status!=='pass'||r.capacity.active_count!==10000)process.exit(1);console.log('pass');`;
 const start=performance.now(),r=spawnSync(process.execPath,['--import','./tests/workflow-members/offline.mjs','--input-type=module','-e',code],{cwd:root,encoding:'utf8',timeout:5000});assert.ifError(r.error);assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'pass');assert.ok(performance.now()-start<5000);
});
test('CI and package expose member tests without changing the existing plan script',()=>{
 const p=JSON.parse(readFileSync(new URL('../../tools/workflow-project/package.json',import.meta.url),'utf8'));assert.equal(p.scripts.test,'node ../../tests/workflow-project/run.mjs');assert.equal(p.scripts['test:members'],'node ../../tests/workflow-members/run.mjs');
 const ci=readFileSync(new URL('../../.github/workflows/workflow-validation.yml',import.meta.url),'utf8');assert.ok(ci.includes('npm run test:members --prefix tools/workflow-project'));
});
