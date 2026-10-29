import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProjectMembers } from '../../tools/workflow-project/members.mjs';
import { input,bind,clone,areaCoordinators,override,member,fact } from './helpers.mjs';
import { blocked } from './members.test.mjs';

test('project Coordinator does not need every developer area',()=>{assert.equal(checkProjectMembers(input()).status,'pass');});
test('area Coordinators cover exactly their declared member areas',()=>{const i=areaCoordinators();assert.equal(checkProjectMembers(i).status,'pass');i.team.members[1].areas=[];bind(i);blocked(i,'coordinator_area_missing');});
for(const [name,change,code] of [
 ['unregistered',i=>i.project.coordinators.assignments[0].github_login='missing','member_missing'],
 ['inactive',i=>i.team.members[1].active=false,'coordinator_invalid'],
 ['wrong role',i=>i.team.members[1].roles=['developer'],'coordinator_invalid'],
 ['duplicate login',i=>i.project.coordinators.assignments.push({...clone(i.project.coordinators.assignments[0]),github_login:'COORD'}),'duplicate_coordinator'],
 ['uncovered area',i=>i.project.coordinators.assignments.pop(),'coordinator_coverage'],
 ['double covered area',i=>i.project.coordinators.assignments[1].area_ids.push('backend'),'coordinator_coverage'],
 ['unknown area',i=>i.project.coordinators.assignments[0].area_ids.push('missing'),'unknown_area'],
 ['overlapping paths',i=>{i.project.areas[0].paths=['src'];i.project.areas[1].paths=['src/api'];},'coordinator_scope_overlap'],
])test('area Coordinator '+name,()=>{const i=areaCoordinators();change(i);bind(i);blocked(i,code);});
for(const [name,change,code] of [
 ['unregistered',i=>i.project.areas[1].integration_owner='missing','member_missing'],
 ['inactive',i=>i.team.members[2].active=false,'owner_invalid'],
 ['owner area missing',i=>i.team.members[2].areas=[],'owner_invalid'],
 ['declaration missing',i=>i.team.members[2].integration_owner=[],'owner_invalid'],
 ['conflicting declaration',i=>i.team.members[0].integration_owner=['contracts'],'owner_declaration_mismatch'],
 ['unknown declaration',i=>i.team.members[0].integration_owner=['missing'],'unknown_area'],
])test('default owner '+name,()=>{const i=input();change(i);bind(i);blocked(i,code);});
test('required owner fact is evaluated only for requested areas',()=>{
 const i=input();i.context.member_facts.pop();assert.equal(checkProjectMembers(i).status,'pass');i.context.request.area_ids=['contracts'];blocked(i,'member_fact_missing','unknown');
});
test('Coordinator and integration owner external access cannot be assumed',()=>{
 const i=input();i.context.member_facts[1].repository_access={state:'unknown',permission:null};blocked(i,'permission_unknown','unknown');
 const j=input();j.context.request.area_ids=['contracts'];j.context.member_facts[2].account_type='bot';blocked(j,'account_not_human');
});
test('approved Issue-specific override does not change the default team owner',()=>{
 const i=override(),before=clone(i);const r=checkProjectMembers(i);assert.equal(r.status,'pass');assert.equal(r.integration_owners[0].github_login,'alice');assert.equal(r.integration_owners[0].source,'override');assert.deepEqual(i,before);
});
for(const [name,change,code] of [
 ['wrong approver',i=>i.context.request.owner_overrides[0].approval.approved_by='alice','override_approval_invalid'],
 ['wrong type',i=>i.context.request.owner_overrides[0].approval.approval_type='other','override_approval_invalid'],
 ['wrong Issue',i=>i.context.request.owner_overrides[0].issue_ref='https://github.com/example/project/issues/99','override_scope_mismatch'],
 ['wrong work',i=>i.context.request.owner_overrides[0].work_id='issue-99','override_scope_mismatch'],
 ['outside area',i=>i.context.request.owner_overrides[0].area_id='backend','override_scope_mismatch'],
 ['duplicate area',i=>i.context.request.owner_overrides.push(clone(i.context.request.owner_overrides[0])),'duplicate_override'],
 ['unregistered human',i=>i.context.request.owner_overrides[0].github_login='missing','member_missing'],
 ['future approval',i=>i.context.request.owner_overrides[0].approval.approved_at='2026-10-29T00:01:00Z','override_approval_invalid'],
])test('owner override '+name,()=>{const i=override();change(i);bind(i);blocked(i,code);});
test('override recipient needs the area and external membership',()=>{
 const i=override();i.context.request.owner_overrides[0].github_login='coord';blocked(i,'member_area_missing');
});
test('project and area Coordinator decisions use the same case-folded login',()=>{
 const i=override(areaCoordinators());i.context.request.owner_overrides[0].approval.approved_by='OWNER';assert.equal(checkProjectMembers(i).status,'pass');
});
