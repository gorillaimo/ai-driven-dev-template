import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScanResult as normalize } from '../../tools/workflow-security/normalize.mjs';
import { planSecurityChecks } from '../../tools/workflow-security/plan.mjs';
import { validateSecurityArtifact } from '../../tools/workflow-security/schema.mjs';
import { scannerFixture,rawFor,receipt } from './fixture.mjs';
export function result(id,detected=false,change=()=>{}){const s=scannerFixture(id),plan=planSecurityChecks(s),r=receipt(s,id,detected);change(r);return normalize({toolId:id,rawResult:JSON.stringify(rawFor(id,detected)),receipt:r,context:{...s.context,plan,check_id:'secrets'}});}
for(const id of ['gitleaks','osv','semgrep','trivy']){
 test(id+' clean complete result and P1 bridge',()=>{const r=result(id);assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(validateSecurityArtifact('result',r).valid,true);assert.equal(r.verification.artifact_kind,'verification');assert.equal(r.verification.test_count,null);assert.ok(!Object.hasOwn(r,'database_fetched_at'));});
 test(id+' detection without raw secret/message/code',()=>{const r=result(id,true);assert.equal(r.status,'failed');assert.ok(r.findings.length);assert.ok(!/SECRET_CANARY/.test(JSON.stringify(r)));});
 for(const [name,change]of [['timeout',r=>r.timed_out=true],['partial',r=>r.completed=false],['stop unknown',r=>r.stopped=false],['tool version',r=>r.version='wrong'],['zero targets',r=>r.target_count=0],['output limit',r=>r.output_limited=true],['unexpected exit',r=>r.exit_code=99]])test(id+' cannot promote '+name,()=>assert.notEqual(result(id,false,change).status,'passed'));
}
test('invalid/empty/oversized raw output produces fixed diagnostics only',()=>{const s=scannerFixture('gitleaks'),plan=planSecurityChecks(s);for(const rawResult of ['', '{CANARY_SECRET', 'x'.repeat(10485761)]){const r=normalize({toolId:'gitleaks',rawResult,receipt:receipt(s,'gitleaks'),context:{...s.context,plan,check_id:'secrets'}});assert.notEqual(r.status,'passed');assert.ok(!JSON.stringify(r).includes('CANARY_SECRET'));}});
test('Semgrep errors/empty scans and OSV empty package extraction are not successes',()=>{for(const [id,raw]of [['semgrep',{version:'1.183.0',results:[],errors:[{message:'CANARY_SECRET'}],paths:{scanned:[]}}],['osv',{results:[]}],['trivy',{SchemaVersion:2,Results:[]}]]){const s=scannerFixture(id),plan=planSecurityChecks(s);assert.notEqual(normalize({toolId:id,rawResult:JSON.stringify(raw),receipt:receipt(s,id),context:{...s.context,plan,check_id:'secrets'}}).status,'passed');}});
test('malformed receipt/context or null rows return a sanitized error',()=>{for(const id of ['gitleaks','osv','semgrep','trivy']){const s=scannerFixture(id),plan=planSecurityChecks(s);for(const rawResult of ['[null]','null','{"results":[null]}'])assert.doesNotThrow(()=>{const r=normalize({toolId:id,rawResult,receipt:receipt(s,id),context:{...s.context,plan,check_id:'secrets'}});assert.notEqual(r.status,'passed');});}assert.doesNotThrow(()=>assert.equal(normalize({toolId:'gitleaks',rawResult:'[]',receipt:null,context:null}).status,'error'));});
test('unparseable receipt timestamps do not leak into a record',()=>{const s=scannerFixture('gitleaks'),plan=planSecurityChecks(s),r=receipt(s,'gitleaks');r.started_at='SECRET_CANARY';const out=normalize({toolId:'gitleaks',rawResult:'[]',receipt:r,context:{...s.context,plan,check_id:'secrets'}});assert.equal(out.status,'error');assert.ok(!JSON.stringify(out).includes('SECRET_CANARY'));});
test('receipt accessors are rejected before reading properties',()=>{let invoked=false;const bad=Object.defineProperty({},'receipt',{enumerable:true,get(){invoked=true;throw Error('SECRET_CANARY');}});assert.doesNotThrow(()=>normalize(bad));assert.equal(invoked,false);});
test('OSV must not treat only LOCAL dependencies as registry coverage',()=>{const s=scannerFixture('osv'),plan=planSecurityChecks(s),raw=rawFor('osv');raw.results[0].packages[0].package.purl='pkg:npm/synthetic@1?source=LOCAL';const r=normalize({toolId:'osv',rawResult:JSON.stringify(raw),receipt:receipt(s,'osv'),context:{...s.context,plan,check_id:'secrets'}});assert.notEqual(r.status,'passed');});
test('public snapshot counts fit both context and normalized result through 500000',()=>{
 for(const count of [231159,500000,500001]){
  const s=scannerFixture('osv'),db=s.context.inventory.databases[0];db.snapshot_kind='public_snapshot';db.source='https://osv-vulnerabilities.storage.googleapis.com/npm/all.zip';db.advisory_count=count;s.context.purpose='repository_check';
  assert.equal(validateSecurityArtifact('context',s.context).valid,count<=500000);
  const plan=planSecurityChecks(s);assert.equal(plan.status,count<=500000?'pass':'blocked');
  if(count<=500000){const r=normalize({toolId:'osv',rawResult:JSON.stringify(rawFor('osv')),receipt:receipt(s,'osv'),context:{...s.context,plan,check_id:'secrets'}});assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(validateSecurityArtifact('result',r).valid,true);}
 }
});
