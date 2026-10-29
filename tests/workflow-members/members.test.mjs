import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProjectMembers } from '../../tools/workflow-project/members.mjs';
import { validateMemberArtifact } from '../../tools/workflow-project/member-schema.mjs';
import { input,bind,clone,freeze,ref,claim,assigned,member,fact,stamp } from './helpers.mjs';

export function blocked(i,code,qualification) {
 const r=checkProjectMembers(i);assert.equal(r.status,'blocked');assert.notEqual(r.subject.qualification,'eligible');assert.equal(validateMemberArtifact('result',r).valid,true);
 if(code)assert.ok(r.diagnostics.some(d=>d.code===code),JSON.stringify(r.diagnostics));if(qualification)assert.equal(r.subject.qualification,qualification);return r;
}
test('one specified human is eligible only within a submitted snapshot',()=>{
 const i=input(),before=clone(i),r=checkProjectMembers(freeze(i));assert.equal(r.status,'pass');assert.equal(r.subject.qualification,'eligible');
 assert.deepEqual(r.capacity,{active_count:0,additional_count:1,limit:1});assert.equal(validateMemberArtifact('result',r).valid,true);assert.deepEqual(i,before);
 assert.ok(r.not_evaluated.includes('live_github_and_evidence_authenticity'));assert.ok(!('assigned_issue' in r));
});
test('human identity, repository and member matching use ASCII case folding without mutation',()=>{
 const i=input();i.context.principal.authenticated_login='ALICE';i.context.request.human_owner='Alice';i.team.members[0].github_login='aLiCe';bind(i);i.context.repository='EXAMPLE/PROJECT';i.context.request.issue_ref='https://github.com/EXAMPLE/PROJECT/issues/42';
 const before=clone(i),r=checkProjectMembers(i);assert.equal(r.status,'pass');assert.equal(r.subject.github_login,'alice');assert.deepEqual(i,before);
});
test('record order does not affect component decisions',()=>{
 const i=input(),a=checkProjectMembers(i);i.team.members.reverse();i.context.member_facts.reverse();bind(i);const b=checkProjectMembers(i);
 for(const k of ['status','subject','capacity','coordinators','integration_owners','not_evaluated'])assert.deepEqual(a[k],b[k]);
});
test('object key order preserves the entire result and digest',()=>{
 const i=input(),reverse=v=>Array.isArray(v)?v.map(reverse):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reverse(x)])):v;
 assert.deepEqual(checkProjectMembers(i),checkProjectMembers(reverse(i)));
});
for(const [name,mutate,code,q] of [
 ['inactive',i=>i.team.members[0].active=false,'member_inactive','ineligible'],
 ['reviewer only',i=>i.team.members[0].roles=['reviewer'],'role_missing','ineligible'],
 ['missing area',i=>i.team.members[0].areas=['contracts'],'member_area_missing','ineligible'],
 ['bot member',i=>i.context.member_facts[0].account_type='bot','account_not_human','ineligible'],
 ['unknown account',i=>i.context.member_facts[0].account_type='unknown','account_unknown','unknown'],
 ['missing fact',i=>i.context.member_facts.shift(),'member_fact_missing','unknown'],
 ['denied access',i=>i.context.member_facts[0].repository_access={state:'denied',permission:null},'repository_denied','ineligible'],
 ['unknown access',i=>i.context.member_facts[0].repository_access={state:'unknown',permission:null},'permission_unknown','unknown'],
 ['custom permission',i=>i.context.member_facts[0].repository_access.permission='custom-developer','permission_unknown','unknown'],
 ['wrong human',i=>i.context.principal.authenticated_login='coord','principal_mismatch','ineligible'],
 ['unknown credential',i=>{i.context.principal.credential_kind='unknown';i.context.principal.authenticated_login=null;},'principal_unknown','unknown'],
 ['missing principal evidence',i=>i.context.principal.evidence=null,'principal_unknown','unknown'],
 ['no human behind bot',i=>{i.context.principal.credential_kind='bot';i.context.principal.authenticated_login='app[bot]';},'delegation_unknown','unknown'],
])test('subject '+name,()=>{const i=input();mutate(i);bind(i);blocked(i,code,q);});
const permissions=['read','triage','write','maintain','admin'];
for(const [requiredIndex,required] of permissions.entries())for(const [actualIndex,actual] of permissions.entries())test('permission '+actual+' meets '+required,()=>{
 const i=input();i.project.required_repository_permission=required;for(const f of i.context.member_facts)f.repository_access.permission=actual;bind(i);
 if(actualIndex>=requiredIndex)assert.equal(checkProjectMembers(i).status,'pass');else blocked(i,'permission_insufficient','ineligible');
});
test('bot credential evaluates the named human and confirmed delegation',()=>{
 const i=input();Object.assign(i.context.principal,{credential_kind:'bot',authenticated_login:'app[bot]',on_behalf_of:'ALICE',delegation:{state:'confirmed',evidence:clone(ref)}});
 const r=checkProjectMembers(i);assert.equal(r.status,'pass');assert.equal(r.subject.github_login,'alice');
 i.context.principal.on_behalf_of='coord';blocked(i,'principal_mismatch');
});
test('a denied bot delegation stays a known denial without affirmative evidence',()=>{
 const i=input();Object.assign(i.context.principal,{credential_kind:'bot',authenticated_login:'app[bot]',on_behalf_of:'alice',delegation:{state:'denied',evidence:null}});
 blocked(i,'delegation_denied','ineligible');
});
test('bot credentials cannot treat a registered human login as the bot identity',()=>{
 const i=input();Object.assign(i.context.principal,{credential_kind:'bot',authenticated_login:'coord',on_behalf_of:'alice',delegation:{state:'confirmed',evidence:clone(ref)}});blocked(i,'principal_mismatch');
});
test('candidate review cannot ignore an existing different assignee',()=>{const i=input();i.context.request.assignees=['coord'];blocked(i,'assignee_mismatch');});
test('AI recorder must carry on_behalf_of, independently of the credential principal',()=>{
 const i=input();i.context.recorded_by={actor_type:'ai_agent',actor_ref:'codex'};blocked(i,'schema_invalid');i.context.recorded_by.on_behalf_of='alice';assert.equal(checkProjectMembers(i).status,'pass');
});
test('assigned owner requires both assignee inclusion and responsibility confirmation',()=>{
 const i=assigned();assert.equal(checkProjectMembers(i).status,'pass');i.context.request.assignees=['coord'];blocked(i,'assignee_mismatch');
 i.context.request.assignees=['alice','coord'];assert.equal(checkProjectMembers(i).status,'pass');i.context.request.responsibility_confirmation={state:'unknown',evidence:null};blocked(i,'responsibility_unknown','unknown');
});
test('known denial and unknown are separate diagnostics; unknown cannot become eligible',()=>{
 const i=input();i.team.members[0].active=false;i.context.member_facts[0].repository_access={state:'unknown',permission:null};bind(i);blocked(i,'permission_unknown','unknown');
});
test('unrelated inactive member needs no external fact',()=>{
 const i=input();i.team.members.push({...member('retired'),active:false});bind(i);assert.equal(checkProjectMembers(i).status,'pass');
});
for(const [state,code] of [['member',null],['not_member','team_not_member'],['unknown','team_unknown'],['not_applicable','team_unknown']])test('Organization Team '+state,()=>{
 const i=input();i.project.membership_source.organization_team={organization:'Example',team_slug:'devs'};i.team.membership_source=clone(i.project.membership_source);
 for(const f of i.context.member_facts)f.organization_team={state,organization:'example',team_slug:'devs',...(state==='member'?{evidence:clone(ref)}:{})};bind(i);
 if(code)blocked(i,code);else {assert.equal(checkProjectMembers(i).status,'pass');i.context.member_facts[0].organization_team.team_slug='other';blocked(i,'team_mismatch');}
});
test('no Organization Team configured means no Team lookup is required',()=>{
 const i=input();delete i.team.membership_source.organization_team;for(const f of i.context.member_facts)f.organization_team={state:'unknown',organization:null,team_slug:null};bind(i);assert.equal(checkProjectMembers(i).status,'pass');
});
for(const [name,mutate,code] of [
 ['duplicate login',i=>i.team.members.push({...clone(i.team.members[0]),github_login:'ALICE'}),'duplicate_member'],
 ['duplicate fact',i=>i.context.member_facts.push({...clone(i.context.member_facts[0]),github_login:'ALICE'}),'duplicate_fact'],
 ['unknown fact',i=>i.context.member_facts.push(fact('other')),'unknown_fact'],
 ['duplicate area',i=>i.project.areas.push(clone(i.project.areas[0])),'duplicate_area'],
 ['unknown area in member',i=>i.team.members[0].areas=['missing'],'unknown_area'],
 ['unknown request area',i=>i.context.request.area_ids=['missing'],'unknown_area'],
 ['project ID',i=>i.team.project_id='other-project','identity_mismatch'],
 ['membership source',i=>i.team.membership_source.organization_team={organization:'example',team_slug:'devs'},'membership_source_mismatch'],
 ['Issue repository',i=>i.context.request.issue_ref='https://github.com/other/project/issues/42','issue_identity_mismatch'],
 ['Issue work ID',i=>i.context.request.work_id='issue-43','issue_identity_mismatch'],
 ['non GitHub Issue',i=>i.context.request.issue_ref='https://evil.example/example/project/issues/42','issue_identity_mismatch'],
 ['duplicate assignee',i=>i.context.request.assignees=['alice','ALICE'],'duplicate_assignee'],
 ['empty registry',i=>{i.team.members=[];i.context.member_facts=[];},'member_missing'],
])test('configuration '+name,()=>{const i=input();mutate(i);bind(i);blocked(i,code);});
for(const field of ['project_id','repository','project_revision','team_revision','project_digest','team_digest'])test('context binding '+field,()=>{
 const i=input();i.context[field]=field.endsWith('digest')?'f'.repeat(64):field.endsWith('revision')?2:field==='repository'?'other/project':'other-project';blocked(i,'context_mismatch');
});
for(const [name,mutate,code] of [
 ['expired',i=>i.context.evaluated_at='2026-10-29T01:00:01Z','snapshot_stale'],
 ['future observed',i=>i.context.evaluated_at='2026-10-28T23:59:59Z','snapshot_future'],
 ['before team update',i=>i.team.updated_at='2026-10-29T00:00:01Z','snapshot_before_configuration'],
 ['before project update',i=>i.project.updated_at='2026-10-29T00:00:01Z','snapshot_before_configuration'],
])test('freshness '+name,()=>{const i=input();mutate(i);bind(i);blocked(i,code,'unknown');});
test('freshness exactly at the explicit limit is allowed',()=>{const i=input();i.context.evaluated_at='2026-10-29T01:00:00Z';assert.equal(checkProjectMembers(i).status,'pass');});
for(const kind of ['project','team','context'])for(const name of ['version','field','required'])test('schema '+kind+' '+name,()=>{
 const i=input();if(name==='version')i[kind].schema_version=2;else if(name==='field')i[kind].PRIVATE_CANARY=true;else delete i[kind][kind==='context'?'source':'updated_by'];bind(i);const r=blocked(i,'schema_invalid');assert.ok(!JSON.stringify(r).includes('PRIVATE_CANARY'));
});
test('affirmative permission or Team membership requires evidence',()=>{
 const i=input();delete i.context.member_facts[0].repository_access.evidence;blocked(i,'schema_invalid');
 const j=input();j.context.member_facts[0].organization_team={state:'member',organization:'example',team_slug:'devs'};blocked(j,'schema_invalid');
});
test('capacity is computed without changing reservations',()=>{
 const i=input();i.team.members[0].max_concurrent_issues=2;i.context.active_claims=[claim(1)];bind(i);const before=clone(i),r=checkProjectMembers(i);
 assert.equal(r.status,'pass');assert.deepEqual(r.capacity,{active_count:1,additional_count:1,limit:2});assert.deepEqual(i,before);assert.deepEqual(checkProjectMembers(i),r);
 i.team.members[0].max_concurrent_issues=1;bind(i);blocked(i,'capacity_exceeded');
});
for(const inventory of ['partial','unknown'])test('claim inventory '+inventory+' cannot prove spare capacity',()=>{const i=input();i.context.claims_inventory_status=inventory;const r=blocked(i,'claims_inventory_unknown','unknown');assert.equal(r.capacity,null);});
test('existing self claim consumes zero additional slots only in assigned-owner mode',()=>{
 const i=assigned();i.context.active_claims=[claim(42,'ALICE')];const r=checkProjectMembers(i);assert.equal(r.status,'pass');assert.deepEqual(r.capacity,{active_count:1,additional_count:0,limit:1});
 i.context.request.mode='candidate';blocked(i,'issue_already_claimed');
});
test('a claim owned by someone else cannot be reassigned by this check',()=>{const i=assigned();i.context.active_claims=[claim(42,'owner')];blocked(i,'claim_owner_mismatch');});
for(const [name,mutate,code] of [
 ['duplicate claim ID',i=>{const c=claim(2);c.claim_id='claim-1';i.context.active_claims=[claim(1),c];},'duplicate_claim'],
 ['two active claims per Issue',i=>{const c=claim(1,'owner');c.claim_id='other-claim';i.context.active_claims=[claim(1),c];},'duplicate_claim'],
 ['unregistered owner',i=>i.context.active_claims=[claim(1,'missing')],'claim_member_missing'],
 ['claim work mismatch',i=>{i.context.active_claims=[claim(1)];i.context.active_claims[0].work_id='issue-2';},'issue_identity_mismatch'],
 ['claim repository mismatch',i=>{i.context.active_claims=[claim(1)];i.context.active_claims[0].issue_ref='https://github.com/other/project/issues/1';},'issue_identity_mismatch'],
])test('claim integrity '+name,()=>{const i=input();mutate(i);blocked(i,code);});
test('an inactive holder and an old claim remain in the inventory',()=>{
 const i=input();i.team.members.push({...member('paused'),active:false});i.context.active_claims=[claim(1,'paused'),claim(2,'alice')];bind(i);
 const r=blocked(i,'capacity_exceeded');assert.equal(r.capacity.active_count,1);assert.equal(i.context.active_claims.length,2);
});
