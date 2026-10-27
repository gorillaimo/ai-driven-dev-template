// Contract tests for bundled synthetic examples, not a runtime Project validator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, lstatSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parseDocument, visit } from 'yaml';
const root=new URL('../../',import.meta.url),kinds=['project','delivery-plan','team'];
const schemaDirectory='.ai-workflow/schemas/project/v1/';
const templateDirectory='.ai-workflow/templates/project/v1/';
const fixtureDirectory='tests/project-schema/fixtures/';
const maxFileBytes=1024*1024,maxFixtureBytes=5*1024*1024;
const tags=['str','int','bool','null','float','map','seq'].map(t=>'tag:yaml.org,2002:'+t);
function read(path){const url=new URL(path,root),stat=lstatSync(url);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=maxFileBytes,'file_boundary');return readFileSync(url,'utf8');}
function parse(text){
 if(Buffer.byteLength(text)>maxFileBytes)throw Error('yaml_size');
 const doc=parseDocument(text,{version:'1.2',uniqueKeys:true});
 if(doc.errors.length||doc.warnings.length)throw Error('yaml_invalid');
 visit(doc,{Alias(){throw Error('yaml_alias');},Node(_key,node){if(node.tag&&!tags.includes(node.tag))throw Error('yaml_tag');}});
 return doc.toJS({maxAliasCount:0});
}
const ajv=new Ajv({strict:true,allErrors:true});addFormats(ajv);
ajv.addSchema(JSON.parse(read('.ai-workflow/schemas/issue/v1/common.schema.json')));
for(const name of ['common',...kinds]){
 const schema=JSON.parse(read(schemaDirectory+name+'.schema.json'));
 assert.equal(ajv.validateSchema(schema),true,'meta_schema: '+name);ajv.addSchema(schema);
}
const validators=Object.fromEntries(kinds.map(k=>[k,ajv.getSchema('urn:ai-workflow:project:v1:'+k)]));
function inspect(kind,value){
 const validator=validators[kind],valid=!!validator(value);
 const diagnostics=(validator.errors??[]).map(({instancePath,schemaPath,keyword})=>({kind,instancePath,schemaPath,keyword}));
 diagnostics.sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
 return {valid,diagnostics};
}
function apply(value,changes=[]){
 for(const c of changes){const parent=c.path.slice(0,-1).reduce((v,k)=>v[k],value),key=c.path.at(-1);if(c.remove)delete parent[key];else parent[key]=structuredClone(c.value);}
 return value;
}
const cases=JSON.parse(read('tests/project-schema/cases.json'));
for(const kind of kinds)test('template format: '+kind,()=>{
 const value=parse(read(templateDirectory+kind+'.yaml')),before=JSON.stringify(value);
 assert.equal(inspect(kind,value).valid,true,JSON.stringify(inspect(kind,value).diagnostics));
 assert.equal(JSON.stringify(value),before);assert.deepEqual(inspect(kind,value),inspect(kind,value));
});
for(const c of cases)test(c.id,()=>{
 if(c.keyword==='yaml'){assert.throws(()=>parse(read(fixtureDirectory+c.file)));return;}
 const value=parse(read(fixtureDirectory+c.file));
 if(c.changes?.length)assert.equal(inspect(c.kind,value).valid,true,'invalid mutation base');
 apply(value,c.changes);const before=JSON.stringify(value),result=inspect(c.kind,value);
 assert.equal(result.valid,c.valid,JSON.stringify(result.diagnostics));
 if(c.keyword)assert.ok(result.diagnostics.some(d=>d.keyword===c.keyword),JSON.stringify(result.diagnostics));
 assert.deepEqual(inspect(c.kind,value),result);assert.equal(JSON.stringify(value),before);
});
test('manifest IDs and fixture coverage are complete and bounded',()=>{
 assert.equal(new Set(cases.map(c=>c.id)).size,cases.length);let total=0;
 for(const file of readdirSync(new URL(fixtureDirectory,root))){assert.ok(cases.some(c=>c.file===file),'unlisted fixture');const stat=lstatSync(new URL(fixtureDirectory+file,root));assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=maxFileBytes);total+=stat.size;}
 assert.ok(total<=maxFixtureBytes);
});
test('bundled examples agree without acting as a general cross-artifact validator',()=>{
 const [project,plan,team]=kinds.map(k=>parse(read(templateDirectory+k+'.yaml')));
 assert.equal(project.project_id,plan.project_id);assert.equal(project.project_id,team.project_id);
 assert.equal(project.runtime_backend,'issues');assert.equal(project.coordination_mode,'manual');
 assert.deepEqual(project.membership_source,team.membership_source);assert.equal(team.membership_source.organization_team,null);
 const areas=new Set(project.areas.map(a=>a.area_id)),members=new Set(team.members.map(m=>m.github_login)),features=new Set(plan.features.map(f=>f.feature_id));
 for(const assignment of project.coordinators.assignments)assert.ok(members.has(assignment.github_login));
 for(const area of project.areas)if(area.shared)assert.ok(members.has(area.integration_owner));
 for(const f of plan.features){for(const id of f.area_ids)assert.ok(areas.has(id));for(const d of f.depends_on)assert.ok(features.has(d.feature_id));assert.equal(f.source_ref.target,'docs/system-context.md');}
 for(const m of team.members)for(const id of [...m.areas,...m.integration_owner])assert.ok(areas.has(id));
});
test('common actors/references/approval are reused; standard events remain outside Project artifacts',()=>{
 const common=JSON.parse(read(schemaDirectory+'common.schema.json'));
 assert.equal(common.$defs.envelope.properties.updated_by.$ref,'urn:ai-workflow:issue:v1:common#/$defs/actor');
 assert.equal(common.$defs.membershipSource.properties.organization_team.anyOf[1].properties.organization.$ref,'urn:ai-workflow:issue:v1:common#/$defs/login');
 for(const name of ['actor','event','reference','approval'])assert.ok(!Object.hasOwn(common.$defs,name));
 const old=JSON.parse(read('.ai-workflow/schemas/issue/v1/common.schema.json'));assert.ok(old.$defs.event);assert.ok(old.$defs.envelope.properties.project_id);assert.ok(old.$defs.envelope.properties.feature_id);
});
test('unknown schema URNs cannot silently fetch or compile',()=>{
 const local=new Ajv({strict:true});assert.throws(()=>local.compile({$ref:'urn:ai-workflow:project:v99:unknown'}));
});
test('diagnostics exclude field values and command strings',()=>{
 const value=parse(read(templateDirectory+'project.yaml'));value.repository='SYNTHETIC_CANARY_ONLY';
 const r=inspect('project',value);assert.equal(r.valid,false);assert.ok(!JSON.stringify(r).includes('SYNTHETIC_CANARY_ONLY'));
});
test('old standalone Issue envelope needs no Project adoption',()=>{
 const local=new Ajv({strict:true});addFormats(local);local.addSchema(JSON.parse(read('.ai-workflow/schemas/issue/v1/common.schema.json')));
 local.addSchema(JSON.parse(read('.ai-workflow/schemas/issue/v1/plan.schema.json')));
 const value=parse(read('.ai-workflow/templates/issue/v1/plan.yaml'));
 assert.equal(Object.hasOwn(value,'project_id'),false);assert.equal(Object.hasOwn(value,'feature_id'),false);
 assert.equal(local.getSchema('urn:ai-workflow:issue:v1:plan')(value),true);
});
test('schema covers shapes, not cycles, unique entity IDs, member verification or runtime authorization',()=>{
 const plan=parse(read(templateDirectory+'delivery-plan.yaml')),feature=structuredClone(plan.features[0]);
 feature.depends_on=[{feature_id:feature.feature_id,reason:'Synthetic cycle'}];plan.features.push(feature);
 plan.features[0].issue_refs=[{issue_ref:'https://github.com/example/project/issues/99',work_id:'issue-1',required:true}];
 assert.equal(inspect('delivery-plan',plan).valid,true);
 const team=parse(read(templateDirectory+'team.yaml'));team.members.push(structuredClone(team.members[0]));team.members[0].areas=['unregistered-area'];
 assert.equal(inspect('team',team).valid,true);
 const p=parse(read(templateDirectory+'project.yaml'));p.coordinators.assignments[0].github_login='unverified-user';assert.equal(inspect('project',p).valid,true);
});
test('input keys do not affect verdict and extension content is never executed',()=>{
 const value=parse(read(templateDirectory+'project.yaml')),dir=mkdtempSync(join(tmpdir(),'project-schema-command-'));
 try{const marker=join(dir,'must-not-exist');value.extensions={command:'touch '+marker};const before=structuredClone(value);assert.equal(inspect('project',value).valid,true);assert.deepEqual(value,before);assert.equal(existsSync(marker),false);assert.deepEqual(inspect('project',Object.fromEntries(Object.entries(value).reverse())),inspect('project',value));}
 finally{rmSync(dir,{recursive:true,force:true});}
});
test('CI executes new forms without changing privileges or application commands',()=>{
 const workflow=parse(read('.github/workflows/workflow-validation.yml'));
 assert.deepEqual(workflow.permissions,{contents:'read'});assert.deepEqual(workflow.jobs.validate.strategy.matrix.node,[22,24]);
 assert.ok(workflow.jobs.validate.steps.find(s=>s.id==='regression').run.includes('npm run test:project --prefix tools/workflow-schema'));
 const pkg=JSON.parse(read('tools/workflow-schema/package.json'));assert.equal(pkg.scripts['test:project'],'node project.test.mjs');assert.equal(pkg.scripts.test,'node --test validate.mjs');
});
if(!process.env.PROJECT_SCHEMA_CHILD)test('cold suite is offline, bounded to five seconds, and leaves bundled files unchanged',()=>{
 const files=[schemaDirectory+'common.schema.json',...kinds.map(k=>schemaDirectory+k+'.schema.json'),...kinds.map(k=>templateDirectory+k+'.yaml'),...readdirSync(new URL(fixtureDirectory,root)).map(f=>fixtureDirectory+f)];
 const checksum=()=>files.map(f=>createHash('sha256').update(read(f)).digest('hex'));
 const before=checksum(),dir=mkdtempSync(join(tmpdir(),'project-schema-offline-'));
 try{
  const preload=join(dir,'deny.mjs');writeFileSync(preload,`import {syncBuiltinESMExports} from 'node:module';import http from 'node:http';import https from 'node:https';import net from 'node:net';import dns from 'node:dns';import cp from 'node:child_process';const deny=()=>{throw Error('external_operation_forbidden')};for(const m of [http,https,net,dns,cp])for(const k of ['request','get','connect','createConnection','lookup','resolve','exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'])if(typeof m[k]==='function')m[k]=deny;globalThis.fetch=deny;syncBuiltinESMExports();`);
  const start=performance.now(),out=spawnSync(process.execPath,['--import',preload,new URL('./project.test.mjs',import.meta.url).pathname],{cwd:new URL('.',root),env:{...process.env,PROJECT_SCHEMA_CHILD:'1'},encoding:'utf8',timeout:5000,maxBuffer:1024*1024});
  assert.ifError(out.error);assert.equal(out.status,0,out.stderr);assert.ok(performance.now()-start<5000);assert.deepEqual(checksum(),before);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
