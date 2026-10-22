import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadRules,parseYaml,readLocal} from '../../tools/workflow-rules/load.mjs';
import {resolveRules,validateArtifact} from '../../tools/workflow-rules/resolve.mjs';
test('unsafe YAML rejected',()=>{
 for(const s of ['a: 1\na: 2','a: &x 1\nb: *x','a: !custom hi','---\na: 1\n---\nb: 2']) assert.throws(()=>parseYaml(s));
});
test('repository boundaries, symlinks, non-files and oversized input',()=>{
 const root=mkdtempSync(join(tmpdir(),'rules-'));const outside=mkdtempSync(join(tmpdir(),'outside-'));
 try{writeFileSync(join(root,'ok.md'),'ok');writeFileSync(join(outside,'secret.md'),'synthetic');symlinkSync(join(outside,'secret.md'),join(root,'escape.md'));mkdirSync(join(root,'dir'));
 assert.equal(readLocal(root,'ok.md'),'ok');for(const p of ['../secret.md','/etc/passwd','escape.md','dir','https://example.com']) assert.throws(()=>readLocal(root,p));
 writeFileSync(join(root,'big.md'),'x'.repeat(1048577));assert.throws(()=>readLocal(root,'big.md'));
 }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
test('committed legacy, templates, digest and missing source',()=>{
 const root=new URL('../../',import.meta.url).pathname;const loaded=loadRules(root);assert.equal(loaded.rules[0].rule_id,'legacy');
 const ctx=parseYaml(readLocal(root,'.ai-workflow/templates/rules/v1/context.yaml'));
 assert.equal(resolveRules({...loaded,context:ctx,optIns:[]}).status,'pass');
 for(const kind of ['rule','context','resolution']) assert.equal(validateArtifact(kind,parseYaml(readLocal(root,'.ai-workflow/templates/rules/v1/'+kind+'.yaml'))).valid,true);
 const temp=mkdtempSync(join(tmpdir(),'legacy-'));try{assert.throws(()=>loadRules(temp));}finally{rmSync(temp,{recursive:true,force:true});}
});
test('project module source, digest updates and pair validation',async()=>{
 const {copyFileSync}=await import('node:fs');const root=new URL('../../',import.meta.url).pathname;
 const temp=mkdtempSync(join(tmpdir(),'project-rules-'));
 try{
  for(const dir of ['docs/common/rules/legacy','.ai-workflow/rules/example']) mkdirSync(join(temp,dir),{recursive:true});
  for(const path of ['AGENTS.md','docs/common/development-rules.md','docs/common/rules/legacy/rule.yaml','docs/common/rules/legacy/rule.md']) copyFileSync(join(root,path),join(temp,path));
  copyFileSync(join(root,'tests/workflow-rules/fixtures/conditional.yaml'),join(temp,'.ai-workflow/rules/example/rule.yaml'));
  writeFileSync(join(temp,'.ai-workflow/rules/example/rule.md'),'synthetic rule');
  const loaded=loadRules(temp),context={schema_version:1,technologies:['node']};const first=resolveRules({...loaded,context});
  assert.equal(first.status,'pass');assert.equal(first.rules.find(r=>r.rule_id==='example').reference.target,'.ai-workflow/rules/example/rule.yaml');
  writeFileSync(join(temp,'AGENTS.md'),'changed synthetic legacy');const second=resolveRules({...loadRules(temp),context});assert.notEqual(first.input_digest,second.input_digest);
  assert.notEqual(first.source_digests['AGENTS.md'],second.source_digests['AGENTS.md']);
  rmSync(join(temp,'.ai-workflow/rules/example/rule.md'));assert.throws(()=>loadRules(temp));
 }finally{rmSync(temp,{recursive:true,force:true});}
});
test('constructor is an ordinary rule ID and duplicate project shadowing is rejected',async()=>{
 const {copyFileSync}=await import('node:fs');const root=new URL('../../',import.meta.url).pathname,temp=mkdtempSync(join(tmpdir(),'rule-id-'));
 try{
  mkdirSync(join(temp,'docs/common/rules/legacy'),{recursive:true});mkdirSync(join(temp,'.ai-workflow/rules/constructor'),{recursive:true});
  for(const path of ['AGENTS.md','docs/common/development-rules.md','docs/common/rules/legacy/rule.yaml','docs/common/rules/legacy/rule.md']) copyFileSync(join(root,path),join(temp,path));
  const fixture=readLocal(root,'tests/workflow-rules/fixtures/conditional.yaml').replaceAll('example','constructor');
  writeFileSync(join(temp,'.ai-workflow/rules/constructor/rule.yaml'),fixture);writeFileSync(join(temp,'.ai-workflow/rules/constructor/rule.md'),'synthetic');
  assert.equal(loadRules(temp).rules.length,2);
  mkdirSync(join(temp,'.ai-workflow/rules/legacy'));copyFileSync(join(temp,'docs/common/rules/legacy/rule.yaml'),join(temp,'.ai-workflow/rules/legacy/rule.yaml'));writeFileSync(join(temp,'.ai-workflow/rules/legacy/rule.md'),'synthetic');assert.throws(()=>loadRules(temp),/duplicate_rule/);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
