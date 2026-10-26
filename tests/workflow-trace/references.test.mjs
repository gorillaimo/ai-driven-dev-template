import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectReference} from '../../tools/workflow-trace/references.mjs';
import {checkTraceability} from '../../tools/workflow-trace/check.mjs';
import {fixture} from './fixtures/build.mjs';
import {has} from './graph.test.mjs';
test('local file, explicit anchor, JSON Pointer, unknown fragment, path boundary',()=>{
 const root=mkdtempSync(join(tmpdir(),'trace-ref-'));
 try{
  writeFileSync(join(root,'doc.md'),'# Synthetic {#ac-1}\n');writeFileSync(join(root,'api.yaml'),'paths:\n  /profile:\n    get: {}\n');
  const read=(target,fragment)=>inspectReference(root,{kind:'file',target,...(fragment?{fragment}:{})});
  assert.equal(read('doc.md','ac-1').status,'local_verified');assert.equal(read('api.yaml','/paths/~1profile/get').status,'local_verified');
  assert.equal(read('doc.md','synthetic').status,'not_evaluated');assert.equal(read('api.yaml','/missing').status,'missing');
  assert.equal(read('missing.md').status,'missing');
  for(const p of ['../secret','/etc/passwd']) assert.throws(()=>read(p));
  symlinkSync('/etc/passwd',join(root,'escape.md'));assert.throws(()=>read('escape.md'));
 }finally{rmSync(root,{recursive:true,force:true});}
});
for(const [name,change,code] of [
 ['missing file',f=>{f.references.find(r=>r.reference.target==='tests/example.test.mjs').status='missing';},'reference_missing'],
 ['missing confirmation',f=>f.context.external_confirmations=[],'reference_missing'],
 ['URL falsely local',f=>{f.references.find(r=>r.reference.kind==='url').status='local_verified';},'reference_invalid'],
 ['unsafe ref',f=>f.traceability.nodes[0].ref={kind:'file',target:'../secret'},'schema_invalid'],
]) test(name,()=>{const f=fixture();change(f);has(checkTraceability(f),code);});
test('loader reads the full committed fixture and templates without writes',async()=>{
 const {loadTraceability}=await import('../../tools/workflow-trace/load.mjs');const {validateArtifact}=await import('../../tools/workflow-trace/check.mjs');const {readLocal,parseYaml}=await import('../../tools/workflow-rules/load.mjs');
 const root=new URL('../../',import.meta.url).pathname;
 const paths={traceability:'tests/workflow-trace/fixtures/traceability.yaml',context:'tests/workflow-trace/fixtures/context.yaml',workflow:{plan:'tests/workflow-trace/fixtures/plan.yaml',state:'tests/workflow-trace/fixtures/state.yaml',context:'tests/workflow-check/fixtures/context.yaml',previous:{plan:'tests/workflow-trace/fixtures/plan.yaml',state:'tests/workflow-trace/fixtures/state.yaml'}}};
 const input=loadTraceability(root,paths,{schema_version:1,risk:'low',areas:[],technologies:[],data_types:[]});assert.equal(checkTraceability(input).status,'pass');
 for(const kind of ['context','result','suppression-scope']) assert.equal(validateArtifact(kind,parseYaml(readLocal(root,'.ai-workflow/templates/trace-checks/v1/'+kind+'.yaml'))),true,kind);
});
test('deleted path requires a declared deletion and cannot be called locally verified',()=>{
 const root=mkdtempSync(join(tmpdir(),'trace-delete-'));try{assert.equal(inspectReference(root,{kind:'file',target:'gone.md'},true).status,'deleted_declared');}finally{rmSync(root,{recursive:true,force:true});}
 const f=fixture();f.context.change_inventory[0].operation='deleted';f.context.change_inventory[0].base_digest='0'.repeat(64);const r=f.references.find(r=>r.reference.target==='src/example.mjs');r.status='deleted_declared';r.digest=null;assert.equal(checkTraceability(f).status,'pass');
 delete f.context.change_inventory[0].base_digest;has(checkTraceability(f),'schema_invalid');
});
test('an id reference cannot pretend a missing node exists',()=>{
 const f=fixture();f.traceability.nodes.find(n=>n.id==='test-1').ref={kind:'id',target:'missing-node'};f.references.push({reference:{kind:'id',target:'missing-node'},status:'local_verified',digest:'0'.repeat(64)});has(checkTraceability(f),'reference_invalid');
});
test('fragment reader retains YAML, size and regular-file boundaries',()=>{
 const root=mkdtempSync(join(tmpdir(),'trace-boundary-'));
 try{
  for(const text of ['a: 1\na: 2','a: &x 1\nb: *x','a: !custom value','---\na: 1\n---\nb: 2']){
   writeFileSync(join(root,'bad.yaml'),text);assert.throws(()=>inspectReference(root,{kind:'file',target:'bad.yaml',fragment:'/a'}));
  }
  writeFileSync(join(root,'big.md'),'x'.repeat(1048577));assert.throws(()=>inspectReference(root,{kind:'file',target:'big.md'}));
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('a declared deletion requires absence, not an ordinary verified file',()=>{
 const f=fixture();f.context.change_inventory[0].operation='deleted';f.context.change_inventory[0].base_digest='0'.repeat(64);has(checkTraceability(f),'reference_invalid');
});
