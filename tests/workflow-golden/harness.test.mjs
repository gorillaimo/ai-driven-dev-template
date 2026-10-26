import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, readdirSync, lstatSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadCase, loadSuite, limits, requiredCases } from '../../tools/workflow-golden/load.mjs';
import { compareSnapshot, checkForbidden } from '../../tools/workflow-golden/compare.mjs';
import { evaluate } from '../../tools/workflow-golden/adapters.mjs';
import { runSuite, runCase, serializeReport } from '../../tools/workflow-golden/run.mjs';
import { loadRules } from '../../tools/workflow-rules/load.mjs';
import { resolveRules, digest } from '../../tools/workflow-rules/resolve.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const fixtures=join(root,'tests/workflow-golden/fixtures');
const json=value=>JSON.stringify(value,null,2)+'\n';
function temporary(action){const dir=mkdtempSync(join(tmpdir(),'workflow-golden-'));try{return action(dir);}finally{rmSync(dir,{recursive:true,force:true});}}
function unit(dir){
 for(const sub of ['input','expected'])mkdirSync(join(dir,sub),{recursive:true});
 const c={format_version:1,id:'unit',purpose:'Synthetic loader contract',adapters:['rules'],inputs:{rules:'input/rules.yaml'},expected:{rules:'expected/rules.yaml'},signals:{rules:{status:'pass',codes:[]}},normalize:[]};
 writeFileSync(join(dir,'case.yaml'),json(c));writeFileSync(join(dir,'input/rules.yaml'),'{}');writeFileSync(join(dir,'expected/rules.yaml'),'{}');writeFileSync(join(dir,'forbidden.yaml'),json({format_version:1,rules:[]}));return c;
}
const rewrite=(dir,path,value)=>writeFileSync(join(dir,path),json(value));
function treeDigest(dir){const out=[];function walk(path){for(const n of readdirSync(path).sort()){const f=join(path,n);if(lstatSync(f).isDirectory())walk(f);else out.push([f.slice(dir.length),digest(readFileSync(f))]);}}walk(dir);return json(out);}
test('committed suite covers mandatory cases, executes real adapters, is deterministic and read-only',()=>{
 const before=treeDigest(fixtures),suite=loadSuite(fixtures),report=runSuite(suite);
 assert.equal(report.status,'passed',json(report));assert.ok(report.cases.length>=requiredCases.length);
 for(const id of requiredCases)assert.ok(report.cases.some(c=>c.id===id&&c.status==='passed'),id);
 assert.deepEqual(runSuite(loadSuite(fixtures)),report);assert.equal(treeDigest(fixtures),before);
 assert.ok(report.cases.some(c=>c.adapters.some(a=>a.status==='not_evaluated')));
 assert.ok(Buffer.byteLength(serializeReport(report))<=limits.reportBytes);
});
test('legacy smoke check retains original mandatory documents',()=>{
 const input={...loadRules(root),context:{schema_version:1,risk:'low',areas:[],technologies:[],data_types:[]},optIns:[]};
 assert.equal(resolveRules(input).status,'pass');
 for(const p of ['AGENTS.md','docs/common/development-rules.md'])assert.equal(input.sourceDigests[p],digest(readFileSync(join(root,p),'utf8')));
});
test('object key order normalizes; array order and every extra field remain meaningful',()=>{
 assert.deepEqual(compareSnapshot({b:2,a:1},{a:1,b:2}),[]);
 for(const [a,b] of [[{a:[1,2]},{a:[2,1]}],[{a:1,extra:1},{a:1}],[{a:null},{}]])assert.ok(compareSnapshot(a,b).length);
});
for(const key of ['approved_at','expires_at','commit','input_digest','revision','reference','status','next_stage'])test('comparison preserves safety field '+key,()=>assert.ok(compareSnapshot({[key]:'before'},{[key]:'after'}).length));
for(const normalization of [['/status'],['/**'],['/input_digest'],['/unknown'],['/duration_ms','/duration_ms']])test('unsafe or unknown normalization rejected '+json(normalization),()=>assert.throws(()=>compareSnapshot({}, {}, normalization)));
test('only declared display duration may differ; bad declarations fail',()=>{
 assert.deepEqual(compareSnapshot({duration_ms:1,status:'pass'},{duration_ms:2,status:'pass'},['/duration_ms']),[]);
 assert.ok(compareSnapshot({duration_ms:1},{duration_ms:2}).length);
 assert.throws(()=>compareSnapshot({status:'pass'},{status:'pass'},['/duration_ms']));
});
test('forbidden values, nested subsets, arrays and canary strings are detected without echo',()=>{
 const value={next_stage:'implementation',approvals:[{approved_by:'robot',type:'auto'}],message:'contains SYNTHETIC_CANARY_ONLY'};
 const rules=[{adapter:'workflow',op:'equals',path:'/next_stage',value:'implementation'},{adapter:'workflow',op:'contains',path:'/approvals',value:{type:'auto'}},{adapter:'workflow',op:'text',path:'',value:'SYNTHETIC_CANARY_ONLY'}];
 const out=checkForbidden({workflow:value},rules);assert.equal(out.length,3);assert.ok(!json(out).includes('SYNTHETIC_CANARY_ONLY'));
 assert.equal(checkForbidden({workflow:{next_stage:'tests',approvals:[]}},rules).length,0);
});
for(const rule of [{adapter:'workflow',op:'execute',path:'',value:'x'},{adapter:'missing',op:'text',path:'',value:'x'},{adapter:'workflow',op:'text',path:'bad',value:'x'},{adapter:'workflow',op:'equals',path:'',value:1,unknown:true}])test('invalid forbidden rule rejected '+rule.op,()=>assert.throws(()=>checkForbidden({},[rule])));
test('forbidden missing selected adapter fails instead of silently skipping',()=>assert.throws(()=>checkForbidden({},[{adapter:'workflow',op:'equals',path:'/status',value:'pass'}])));
for(const [field,value] of [['format_version',2],['unknown',1],['adapters',['execute']],['normalize',['/status']],['id','../escape'],['purpose','']])test('loader rejects invalid manifest '+field,()=>temporary(dir=>{const c=unit(dir);c[field]=value;rewrite(dir,'case.yaml',c);assert.throws(()=>loadCase(dir,'unit'));}));
for(const path of ['/tmp/outside.yaml','../outside.yaml','input/../../outside.yaml','input\\outside.yaml'])test('loader rejects path escape '+path,()=>temporary(dir=>{const c=unit(dir);c.inputs.rules=path;rewrite(dir,'case.yaml',c);assert.throws(()=>loadCase(dir,'unit'));}));
for(const text of ['a: 1\na: 2','a: &a x\nb: *a','a: !custom x','---\na: 1\n---\nb: 2'])test('loader rejects unsafe YAML '+text.split('\n')[0],()=>temporary(dir=>{unit(dir);writeFileSync(join(dir,'input/rules.yaml'),text);assert.throws(()=>loadCase(dir,'unit'));}));
test('symlinked file and directory rejected',()=>temporary(dir=>{
 unit(dir);writeFileSync(join(dir,'actual.yaml'),'{}');rmSync(join(dir,'input/rules.yaml'));symlinkSync('../actual.yaml',join(dir,'input/rules.yaml'));assert.throws(()=>loadCase(dir,'unit'));
 rmSync(join(dir,'input'),{recursive:true});mkdirSync(join(dir,'actual'));symlinkSync('actual',join(dir,'input'));assert.throws(()=>loadCase(dir,'unit'));
}));
test('missing expected result and extra file rejected',()=>temporary(dir=>{
 unit(dir);rmSync(join(dir,'expected/rules.yaml'));assert.throws(()=>loadCase(dir,'unit'));
 rewrite(dir,'expected/rules.yaml',{});writeFileSync(join(dir,'unlisted.yaml'),'{}');assert.throws(()=>loadCase(dir,'unit'));
}));
test('file size and file count bounded before parsing',()=>temporary(dir=>{
 unit(dir);writeFileSync(join(dir,'input/rules.yaml'),'x'.repeat(limits.fileBytes+1));assert.throws(()=>loadCase(dir,'unit'));
 writeFileSync(join(dir,'input/rules.yaml'),'{}');for(let i=0;i<limits.caseFiles;i++)writeFileSync(join(dir,'input',i+'.yaml'),'{}');assert.throws(()=>loadCase(dir,'unit'));
}));
test('unregistered and duplicate cases, omitted mandatory case and invalid index fail closed',()=>temporary(dir=>{
 cpSync(fixtures,dir,{recursive:true});const index=JSON.parse(readFileSync(join(dir,'cases.json'),'utf8'));
 const cases=[...index.cases];index.cases.push(index.cases[0]);rewrite(dir,'cases.json',index);assert.throws(()=>loadSuite(dir));
 index.cases=cases.slice(1);rewrite(dir,'cases.json',index);assert.throws(()=>loadSuite(dir));
 index.cases=cases;index.typo=true;rewrite(dir,'cases.json',index);assert.throws(()=>loadSuite(dir));
 delete index.typo;rewrite(dir,'cases.json',index);mkdirSync(join(dir,'unregistered'));assert.throws(()=>loadSuite(dir));
}));
test('case count limit and empty suite rejected',()=>temporary(dir=>{
 rewrite(dir,'cases.json',{format_version:1,cases:[]});assert.throws(()=>loadSuite(dir));
 rewrite(dir,'cases.json',{format_version:1,cases:Array.from({length:limits.cases+1},(_,i)=>'case-'+i)});assert.throws(()=>loadSuite(dir));
}));
test('snapshot mutation and expected signal mutation fail without actual values in report',()=>{
 const c=loadCase(join(fixtures,'low-docs'),'low-docs');c.expected.workflow.status='SYNTHETIC_CANARY_ONLY';
 const r=runCase(c);assert.equal(r.status,'failed');assert.ok(!json(r).includes('SYNTHETIC_CANARY_ONLY'));
 const d=loadCase(join(fixtures,'low-docs'),'low-docs');d.manifest.signals.workflow.status='blocked';assert.equal(runCase(d).status,'failed');
});
test('unknown adapter and adapter exception cannot become passed',()=>{
 assert.throws(()=>evaluate('execute',{}));
 const c=loadCase(join(fixtures,'low-docs'),'low-docs');c.inputs.plan={};assert.equal(runCase(c).status,'failed');
});
test('negative workflow and trace cases pass only with the expected block/warn',()=>{
 const suite=loadSuite(fixtures);
 for(const id of ['high-approval','missing-ac-test','missing-ac-test-draft','implementation-before-tests','always-on-conflict','forbidden-output'])assert.equal(runCase(suite.find(c=>c.manifest.id===id)).status,'passed');
 const resume=suite.find(c=>c.manifest.id==='safe-resume');const r=evaluate('workflow',resume.inputs.workflow);assert.equal(r.next_stage,'validation');assert.equal(r.resume_decision,'candidate');
});
test('adapters preserve input; body instructions and commands remain inert data',()=>temporary(dir=>{
 const c=loadCase(join(fixtures,'brownfield-intake'),'brownfield-intake'),marker=join(dir,'must-not-exist');
 c.inputs.brownfield.commands[0].command='touch '+marker;
 const before=json(c.inputs);for(const adapter of c.manifest.adapters)evaluate(adapter,c.inputs[adapter]);
 assert.equal(json(c.inputs),before);assert.equal(existsSync(marker),false);
}));
test('cold executable is offline, does not write fixtures, and exits consistently',()=>temporary(dir=>{
 const sentinel=join(dir,'deny.mjs');writeFileSync(sentinel,`import {syncBuiltinESMExports} from 'node:module';\nimport http from 'node:http';import https from 'node:https';import net from 'node:net';import dns from 'node:dns';import cp from 'node:child_process';\nconst deny=()=>{throw new Error('external_operation_forbidden')};\nfor(const mod of [http,https,net,dns,cp])for(const k of ['request','get','connect','createConnection','lookup','resolve','exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'])if(typeof mod[k]==='function')mod[k]=deny;globalThis.fetch=deny;syncBuiltinESMExports();`);
 const before=treeDigest(fixtures),start=performance.now();
 const out=spawnSync(process.execPath,['--import',sentinel,'tools/workflow-golden/run.mjs','--json'],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:limits.reportBytes});
 assert.ifError(out.error);assert.equal(out.status,0,out.stderr+out.stdout);assert.equal(JSON.parse(out.stdout).status,'passed');assert.ok(performance.now()-start<30000);assert.equal(treeDigest(fixtures),before);
 const bad=spawnSync(process.execPath,['tools/workflow-golden/run.mjs','--update'],{cwd:root,encoding:'utf8'});assert.notEqual(bad.status,0);assert.ok(!bad.stdout.includes('SYNTHETIC_CANARY_ONLY'));
}));
test('report size is bounded and overflow fails with a small report',()=>{
 const report={format_version:1,status:'passed',cases:[{id:'x'.repeat(limits.reportBytes)}]};const text=serializeReport(report);assert.ok(Buffer.byteLength(text)<=limits.reportBytes);assert.equal(JSON.parse(text).status,'failed');
});
test('mandatory examples independently preserve their intended stage, approval and scope decisions',()=>{
 const suite=loadSuite(fixtures),get=id=>suite.find(c=>c.manifest.id===id);
 const low=get('low-docs').inputs.workflow;
 for(const id of ['requirements','design','api','tests','implementation']){
  const s=low.plan.stages.find(s=>s.stage_id===id);assert.equal(s.selection,'skipped');assert.ok(s.reason&&s.evidence.length&&s.decided_by);
 }
 const feature=get('medium-feature').inputs.workflow;
 for(const id of ['requirements','design','tests','implementation'])assert.equal(feature.plan.stages.find(s=>s.stage_id===id).selection,'required');
 const bug=get('medium-bugfix').inputs.workflow;assert.equal(bug.context.facts.changes_spec.value,false);assert.equal(bug.plan.stages.find(s=>s.stage_id==='api').selection,'skipped');assert.equal(bug.plan.stages.find(s=>s.stage_id==='tests').selection,'required');
 const high=get('high-approval').inputs.workflow;assert.deepEqual(high.state.approvals,[]);assert.equal(high.plan.stages.find(s=>s.stage_id==='quality').selection,'required');assert.equal(evaluate('workflow',high).next_stage,null);
 const infra=evaluate('rules',get('high-infra').inputs.rules);for(const id of ['infrastructure','security','resiliency'])assert.equal(infra.rules.find(r=>r.rule_id===id).status,'selected');
 const b=get('brownfield-intake').inputs;assert.equal(b.brownfield.status,'partial');assert.equal(b.workflow.context.facts.needs_brownfield.value,true);assert.equal(evaluate('workflow',b.workflow).next_stage,'brownfield');
 const conflict=get('always-on-conflict').inputs.rules,before=structuredClone(conflict);assert.deepEqual(evaluate('rules',conflict).order,[]);assert.deepEqual(conflict,before);assert.equal(conflict.rules.find(r=>r.rule_id==='legacy').level,'always-on');
 for(const id of ['missing-ac-test','missing-ac-test-draft'])assert.equal(evaluate('trace',get(id).inputs.trace).status,id.endsWith('draft')?'warn':'blocked');
});
test('mandatory case cannot omit its mechanism even if index and snapshots are edited',()=>temporary(dir=>{
 cpSync(join(fixtures,'low-docs'),dir,{recursive:true});const m=JSON.parse(readFileSync(join(dir,'case.yaml'),'utf8'));
 m.adapters=['rules'];m.inputs={rules:m.inputs.rules};m.expected={rules:m.expected.rules};m.signals={rules:m.signals.rules};rewrite(dir,'case.yaml',m);
 for(const path of ['input/plan.yaml','input/workflow.yaml','expected/plan.yaml','expected/workflow.yaml'])rmSync(join(dir,path));assert.throws(()=>loadCase(dir,'low-docs'));
}));
test('exact file/count limits accepted; case byte and depth limits rejected',()=>temporary(dir=>{
 let m=unit(dir);writeFileSync(join(dir,'input/rules.yaml'),'{}'+' '.repeat(limits.fileBytes-2));assert.ok(loadCase(dir,'unit'));
 writeFileSync(join(dir,'input/rules.yaml'),'{}');m.assets=[];
 for(let i=0;i<limits.caseFiles-4;i++){const path='input/asset-'+i+'.md';m.assets.push(path);writeFileSync(join(dir,path),'x');}rewrite(dir,'case.yaml',m);assert.ok(loadCase(dir,'unit'));
 writeFileSync(join(dir,'input/over.md'),'x');assert.throws(()=>loadCase(dir,'unit'));
}));
test('case total bytes and directory depth have independent limits',()=>temporary(dir=>{
 const m=unit(dir);m.assets=[];
 for(let i=0;i<6;i++){const path='input/large-'+i+'.md';m.assets.push(path);writeFileSync(join(dir,path),'x'.repeat(limits.fileBytes));}rewrite(dir,'case.yaml',m);assert.throws(()=>loadCase(dir,'unit'));
 for(const path of m.assets)rmSync(join(dir,path));m.assets=[];rewrite(dir,'case.yaml',m);
 const nested=join(dir,...Array(limits.depth+2).fill('nested'));mkdirSync(nested,{recursive:true});assert.throws(()=>loadCase(dir,'unit'));
}));
test('unused adapter in forbidden rule and unknown signals do not silently pass',()=>temporary(dir=>{
 const m=unit(dir);rewrite(dir,'forbidden.yaml',{format_version:1,rules:[{adapter:'trace',op:'equals',path:'/status',value:'pass'}]});assert.throws(()=>loadCase(dir,'unit'));
 rewrite(dir,'forbidden.yaml',{format_version:1,rules:[]});m.signals.rules.typo=true;rewrite(dir,'case.yaml',m);assert.throws(()=>loadCase(dir,'unit'));
}));
test('loader failure produces a bounded failed JSON report and nonzero process exit',()=>temporary(dir=>{
 const preload=join(dir,'broken.mjs');writeFileSync(preload,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';\nconst read=fs.readFileSync;fs.readFileSync=function(path,...args){if(String(path).endsWith('/fixtures/cases.json'))throw new Error('SYNTHETIC_CANARY_ONLY');return read.call(this,path,...args)};syncBuiltinESMExports();`);
 const out=spawnSync(process.execPath,['--import',preload,'tools/workflow-golden/run.mjs','--json'],{cwd:root,encoding:'utf8',timeout:30000});assert.ifError(out.error);assert.equal(out.status,1);
 const report=JSON.parse(out.stdout);assert.equal(report.status,'failed');assert.equal(report.findings[0].code,'fixture_invalid');assert.ok(!out.stdout.includes('SYNTHETIC_CANARY_ONLY'));
}));
test('suite loader identifies the failing registered case without copying file contents',()=>temporary(dir=>{
 cpSync(fixtures,dir,{recursive:true});writeFileSync(join(dir,'low-docs/input/rules.yaml'),'SYNTHETIC_CANARY_ONLY: [');
 assert.throws(()=>loadSuite(dir),error=>error.case_id==='low-docs'&&!error.message.includes('SYNTHETIC_CANARY_ONLY'));
}));
test('synthetic legacy digests match the committed synthetic body assets',()=>{
 for(const c of loadSuite(fixtures)){
  const inputs=[c.inputs.rules,c.inputs.workflow?.ruleInput,c.inputs.plan?.ruleInput,c.inputs.trace?.workflowInput?.ruleInput].filter(Boolean);
  for(const input of inputs)for(const [source,asset] of [['AGENTS.md','AGENTS.md'],['docs/common/development-rules.md','development-rules.md']])assert.equal(input.sourceDigests[source],digest(readFileSync(join(fixtures,c.manifest.id,'input',asset),'utf8')),c.manifest.id+'/'+source);
 }
});
