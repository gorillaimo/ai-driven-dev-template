import test from 'node:test';
import assert from 'node:assert/strict';
import { checkExecutionEvidence as check } from '../../tools/workflow-execution/check.mjs';
import { validateExecutionArtifact as validate } from '../../tools/workflow-execution/schema.mjs';
import { fixture, rebind, ref, source, hash, finding, security, integration, report, event, human } from './fixture.mjs';
const blocked=s=>{const r=check(s);assert.equal(r.status,'blocked',JSON.stringify(r));return r;};
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
test('Project-free synthetic evidence passes only as record consistency',()=>{
 const s=fixture(),r=check(s);assert.equal(r.status,'pass');assert.equal(r.decision,'evidence_complete');assert.equal(validate('result',r).valid,true);
 for(const x of ['approval_authenticity','actual_execution','history_completeness','semantic_correctness','isolation_atomicity'])assert.ok(r.not_evaluated.includes(x));
});
test('deterministic frozen input, no mutation; meaningful input changes change digest',()=>{
 const s=freeze(fixture()),before=JSON.stringify(s);assert.deepEqual(check(s),check(s));assert.equal(JSON.stringify(s),before);
 const t=fixture();t.context.evaluated_at='2026-11-04T00:11:00Z';assert.notEqual(check(t).input_digest,check(s).input_digest);
});
for(const field of ['repository','issue_number','work_id','run_id','attempt','base_sha','head_sha','plan','profile'])test('reject verification binding mismatch: '+field,()=>{
 const s=fixture();s.verifications[0].subject=structuredClone(s.context.subject);
 if(field==='repository')s.verifications[0].repository='other/repo';else s.verifications[0].subject[field]=field==='plan'||field==='profile'?{...s.verifications[0].subject[field],digest:'0'.repeat(64)}:field==='attempt'||field==='issue_number'?2:'different';
 blocked(s);
});
for(const [name,change] of [
 ['missing checks',s=>s.verifications=[]],['unrun',s=>s.verifications[0].status='not_evaluated'],['error',s=>s.verifications[0].status='error'],['nonzero exit',s=>s.verifications[0].exit_code=1],['empty tests',s=>s.verifications[0].test_count=0],['missing log',s=>s.verifications[0].log_refs=[]],['future',s=>s.verifications[0].finished_at='2026-11-05T00:00:00Z'],['reversed times',s=>s.verifications[0].started_at='2026-11-04T00:03:00Z'],['stale',s=>s.context.evaluated_at='2026-11-04T02:00:00Z'],['revoked',s=>{s.grant.revoked=true;rebind(s);}],['expired',s=>s.context.evaluated_at='2026-11-05T00:10:00Z'],['owner',s=>s.context.human_owner='other'],['stage',s=>s.context.stage='implementation'],['contract',s=>s.context.contract_digest='f'.repeat(64)],['design',s=>s.context.design_digest='f'.repeat(64)],['scope',s=>s.verifications[0].scope=['secrets']],['unknown fact',s=>s.context.facts[0].value='unknown'],['denied fact',s=>s.context.facts[0].value=false],['missing fact',s=>s.context.facts=[]],['fact future',s=>s.context.facts[0].observed_at='2026-11-05T00:00:00Z'],['review missing',s=>s.reviews=[]],['review unrun',s=>s.reviews[0].execution_status='not_started'],['review same context',s=>s.reviews[0].reviewer.context_id='impl-1'],['review same actor',s=>s.reviews[0].reviewer.actor=s.reviews[0].implementer.actor],['review missing verification',s=>s.reviews[0].verification_refs=[]],['review wrong digest',s=>s.reviews[0].verification_refs[0].digest='0'.repeat(64)],['unknown version',s=>s.profile.schema_version=2],['unknown property',s=>s.context.extra=true],['unknown budget',s=>{s.profile.limits.cost={status:'unknown'};rebind(s);}],['repairs exceeded',s=>{s.context.subject.attempt=5;rebind(s);}]
])test('no promotion: '+name,()=>{const s=fixture();change(s);blocked(s);});
test('newer failure cannot be hidden behind an older passing check',()=>{const s=fixture();const newer=structuredClone(s.verifications[0]);newer.artifact_id='unit-2';newer.finished_at='2026-11-04T00:03:00Z';newer.status='failed';s.verifications.push(newer);rebind(s);const r=blocked(s);assert.ok(r.checks.some(x=>x.status==='failed'));});
test('equal-time contradictory results are rejected',()=>{const s=fixture();s.verifications.push({...structuredClone(s.verifications[0]),artifact_id:'contradiction',status:'failed'});blocked(s);});
test('required conditional check is never skipped when condition unknown',()=>{const s=fixture();s.profile.checks[0].when={fact_id:'changed',equals:true};s.context.facts.push({fact_id:'changed',value:'unknown',observed_at:s.context.evaluated_at,evidence_refs:[source('changed')]});rebind(s);assert.ok(blocked(s).checks.some(x=>x.status==='not_evaluated'));});
test('normal feature cannot turn off separate review',()=>{const s=fixture();s.profile.review_required=false;s.profile.review_omission_reason='skip';rebind(s);blocked(s);});
for(const status of ['open','disputed','fixed'])test('finding cannot be self-cleared: '+status,()=>{const s=fixture();s.reviews[0].findings=[finding(status)];blocked(s);});
test('fixed finding requires a bound, later independent recheck and verification',()=>{
 const s=fixture(),f=finding('fixed');f.resolution={head_sha:s.context.subject.head_sha,attempt:1,verification_refs:[ref(s.verifications[0])],review_ref:source('placeholder')};
 const follow=structuredClone(s.reviews[0]);follow.artifact_id='recheck-1';follow.started_at='2026-11-04T00:05:00Z';follow.finished_at='2026-11-04T00:06:00Z';follow.rechecks=[{finding_id:f.finding_id,finding_digest:'a'.repeat(64)}];
 // Digest covers the original finding without its resolution; avoid self-reference.
 delete f.resolution;const origin={...f,status:'open'};follow.rechecks[0].finding_digest=hash(origin);
 f.resolution={head_sha:s.context.subject.head_sha,attempt:1,verification_refs:[ref(s.verifications[0])],review_ref:ref(follow),finding_digest:hash(origin)};
 s.reviews[0].findings=[f];s.reviews.push(follow);assert.equal(check(s).status,'pass');
});
test('time-bound human exception remains human_review, not passed',()=>{
 const s=fixture(),f=finding('accepted_risk');f.exception={actor:human,reason:'Synthetic exception',head_sha:s.context.subject.head_sha,issue_number:1,finding_id:f.finding_id,finding_digest:hash({...f,status:'open'}),issued_at:'2026-11-04T00:05:00Z',expires_at:'2026-11-04T01:00:00Z',evidence_refs:[source('exception')]};s.reviews[0].findings=[f];
 assert.equal(blocked(s).decision,'human_review');
 for(const [key,value] of [['expires_at','2026-11-04T00:06:00Z'],['head_sha','0'.repeat(40)],['issue_number',2],['actor',{actor_type:'human',actor_ref:'other'}]]){const t=structuredClone(s);t.reviews[0].findings[0].exception[key]=value;assert.notEqual(blocked(t).decision,'human_review');}
});
test('security results enforce support and database freshness',()=>{const s=fixture();s.profile.checks.push({check_id:'secrets',kind:'security-result',domain:'app',acs:['ac-1']});s.securityResults=[security(s)];rebind(s);assert.equal(check(s).status,'pass');for(const key of ['supported','database_fetched_at']){const t=structuredClone(s);t.securityResults[0][key]=key==='supported'?false:'2026-11-03T00:00:00Z';blocked(t);}});
test('integration binds exact ordered subjects and main',()=>{const s=fixture();s.profile.checks.push({check_id:'integration',kind:'integration-result',domain:'app',acs:['ac-1']});rebind(s);const i=integration(s);s.integrationResults=[i];s.context.integration_targets=i.targets;assert.equal(check(s).status,'pass');s.integrationResults[0].main_sha='0'.repeat(40);blocked(s);});
test('report/event refs and duplicates validated without proving run completion',()=>{const s=fixture();s.report=report(s);s.events=[event(s)];assert.equal(check(s).status,'pass');s.report.subjects[0].result_refs[0].digest='0'.repeat(64);blocked(s);delete s.report;s.events.push(event(s));blocked(s);});
test('previous receipts cannot be removed or edited',()=>{const s=fixture();s.previous=fixture();assert.equal(check(s).status,'pass');s.verifications[0].test_count=3;blocked(s);const t=fixture();t.previous=fixture();t.verifications=[];blocked(t);});
test('retained old head does not satisfy current head',()=>{const s=fixture();s.context.subject=structuredClone(s.context.subject);s.context.subject.head_sha='3'.repeat(40);blocked(s);});
test('valid multi-Issue grant does not require human-provided issue list',()=>{const s=fixture();const t=structuredClone(s.grant.selected[0]);t.issue_number=2;t.work_id='issue-2';s.grant.selected.push(t);rebind(s);assert.equal(check(s).status,'pass');});
test('repair preserves old-head receipts and requires explicit closure of old finding',()=>{
 const old=fixture();old.reviews[0].findings=[finding()];old.reviews[0].status='failed';
 const s=fixture();s.context.subject=structuredClone(s.context.subject);s.context.subject.head_sha='3'.repeat(40);s.context.subject.attempt=2;s.grant.selected[0]={...s.grant.selected[0],...s.context.subject};
 s.verifications[0].subject=s.context.subject;s.reviews[0].subject=s.context.subject;s.verifications[0].artifact_id='unit-repaired';s.reviews[0].artifact_id='review-repaired';
 rebind(s);s.verifications.push(...old.verifications);s.reviews.push(...old.reviews);
 assert.equal(check(s).status,'blocked','an omitted old finding must still block');
 const f={...structuredClone(old.reviews[0].findings[0]),subject:s.context.subject,status:'fixed'};
 const close=structuredClone(s.reviews[0]);close.artifact_id='repair-confirmed';close.started_at='2026-11-04T00:05:00Z';close.finished_at='2026-11-04T00:06:00Z';close.rechecks=[{finding_id:f.finding_id,finding_digest:hash(old.reviews[0].findings[0])}];
 f.resolution={head_sha:s.context.subject.head_sha,attempt:2,finding_digest:hash(old.reviews[0].findings[0]),verification_refs:[ref(s.verifications[0])],review_ref:ref(close)};s.reviews[0].findings=[f];s.reviews.push(close);
 assert.equal(check(s).status,'pass',JSON.stringify(check(s)));
});
test('same-head repair supersedes failed execution but retains its receipt',()=>{const s=fixture();const old=structuredClone(s.verifications[0]);old.artifact_id='failed-old';old.finished_at='2026-11-04T00:01:30Z';old.status='failed';old.exit_code=1;s.verifications.push(old);assert.equal(check(s).status,'pass');});
test('conditional optional check can be omitted without bypassing required ACs',()=>{const s=fixture();s.profile.checks.push({check_id:'optional',kind:'security-result',domain:'app',acs:[],when:{fact_id:'changed',equals:true}});s.context.facts.push({fact_id:'changed',value:false,observed_at:s.context.evaluated_at,evidence_refs:[source('changed')]});rebind(s);assert.equal(check(s).status,'pass');});
test('integration order changes and unsupported record references fail',()=>{const s=fixture();s.profile.checks.push({check_id:'integration',kind:'integration-result',domain:'app',acs:['ac-1']});rebind(s);const i=integration(s);i.targets.push({...i.targets[0],issue_number:2,pr_number:3});s.context.integration_targets=structuredClone(i.targets);i.targets.reverse();s.integrationResults=[i];blocked(s);});
test('review cannot omit required checks using a not_evaluated summary',()=>{const s=fixture();s.reviews[0].status='not_evaluated';assert.ok(blocked(s).checks.some(x=>x.status==='not_evaluated'));});
test('leap-second timestamps not supported by JS must not bypass time checks',()=>{const s=fixture();s.verifications[0].finished_at='2026-11-04T00:01:60Z';blocked(s);});
test('duplicate finding IDs must not be silently collapsed',()=>{const s=fixture();const f=finding('open');f.category='suggestion';f.severity='info';f.required_ac=false;s.reviews[0].findings=[f,structuredClone(f)];blocked(s);});
test('an old exception cannot accept a finding for a new head',()=>{const s=fixture(),f=finding('accepted_risk');f.exception={actor:human,reason:'Synthetic',head_sha:f.subject.head_sha,issue_number:1,finding_id:f.finding_id,finding_digest:hash({...f,status:'open'}),issued_at:'2026-11-04T00:05:00Z',expires_at:'2026-11-04T01:00:00Z',evidence_refs:[source('exception')]};s.reviews[0].findings=[f];s.context.subject=structuredClone(s.context.subject);s.context.subject.head_sha='3'.repeat(40);s.grant.selected[0]={...s.grant.selected[0],...s.context.subject};const v=structuredClone(s.verifications[0]);v.subject=s.context.subject;v.artifact_id='new-head-test';s.verifications.push(v);const r=structuredClone(s.reviews[0]);r.subject=s.context.subject;r.artifact_id='new-head-review';r.findings=[];r.verification_refs=[ref(v)];s.reviews.push(r);s.context.grant=ref(s.grant);assert.notEqual(blocked(s).decision,'human_review');});
test('checks cannot skip all coverage of a required AC',()=>{const s=fixture();s.profile.checks[0].when={fact_id:'skip',equals:true};s.context.facts.push({fact_id:'skip',value:false,observed_at:s.context.evaluated_at,evidence_refs:[source('skip')]});rebind(s);blocked(s);});
test('all checker returns, including capped diagnostics/checks, conform to result schema',()=>{const s=fixture();s.profile.checks=Array.from({length:1000},(_,i)=>({check_id:'missing-'+i,kind:'verification',domain:'app',acs:['ac-1'],command_id:'unit',test_check:true,min_tests:1}));rebind(s);const r=blocked(s);assert.equal(validate('result',r).valid,true);});
