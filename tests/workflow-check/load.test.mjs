import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorkflow } from '../../tools/workflow-check/load.mjs';
import { root } from './fixtures/build.mjs';
test('reader rejects missing and external paths without running commands',()=>{
 for(const plan of ['../secret','/etc/passwd','https://example.com','does-not-exist']) assert.throws(()=>loadWorkflow(root,{plan,state:plan,context:plan}));
});
test('committed templates and full fixture are schema-valid and load offline',async()=>{
 const {readLocal,parseYaml}=await import('../../tools/workflow-rules/load.mjs');
 const {checkWorkflow,validateArtifact}=await import('../../tools/workflow-check/check.mjs');
 for(const kind of ['context','result','state-extension']) assert.equal(validateArtifact(kind,parseYaml(readLocal(root,'.ai-workflow/templates/checks/v1/'+kind+'.yaml'))),true,kind);
 const paths=Object.fromEntries(['plan','state','context'].map(k=>[k,'tests/workflow-check/fixtures/'+k+'.yaml']));
 const input=loadWorkflow(root,paths,{schema_version:1,risk:'low',areas:[],technologies:[],data_types:[]});
 assert.equal(checkWorkflow(input).status,'pass');
});
test('loader retains shared YAML and filesystem boundaries',async()=>{
 const {mkdtempSync,writeFileSync,symlinkSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const temp=mkdtempSync(join(tmpdir(),'check-loader-'));
 try{
  for(const text of ['a: 1\na: 2','a: &x 1\nb: *x','a: !custom value','---\na: 1\n---\nb: 2','x'.repeat(1048577)]){
   writeFileSync(join(temp,'bad.yaml'),text);assert.throws(()=>loadWorkflow(temp,{plan:'bad.yaml',state:'bad.yaml',context:'bad.yaml'}));
  }
  symlinkSync('/etc/passwd',join(temp,'escape.yaml'));assert.throws(()=>loadWorkflow(temp,{plan:'escape.yaml',state:'escape.yaml',context:'escape.yaml'}));
 }finally{rmSync(temp,{recursive:true,force:true});}
});
