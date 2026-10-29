import { readFileSync } from 'node:fs';
import { parseYaml } from '../../tools/workflow-rules/load.mjs';
import { canonical, digest } from '../../tools/workflow-rules/resolve.mjs';
export const clone=value=>structuredClone(value);
export const stamp='2026-10-29T00:00:00Z';
export const ref={kind:'url',target:'https://github.com/example/project/issues/42#issuecomment-1'};
export const actor={actor_type:'human',actor_ref:'alice'};
export const approval={approval_type:'integration_owner_override',approved_by:'coord',approved_at:stamp,reference:ref};
export function member(github_login,areas=['backend'],roles=['developer']) {
 return {github_login,active:true,roles,areas,max_concurrent_issues:1,integration_owner:[]};
}
export function fact(github_login) {
 return {github_login,account_type:'human',evidence:clone(ref),repository_access:{state:'confirmed',permission:'write',evidence:clone(ref)},
  organization_team:{state:'not_applicable',organization:null,team_slug:null}};
}
export function bind(i) {
 Object.assign(i.context,{project_id:i.project.project_id,repository:i.project.repository,project_revision:i.project.revision,team_revision:i.team.revision,
  project_digest:digest(canonical(i.project)),team_digest:digest(canonical(i.team))});return i;
}
export function input() {
 const project=parseYaml(readFileSync(new URL('./fixtures/project.yaml',import.meta.url),'utf8'));
 project.coordinators.assignments[0].github_login='coord';project.areas[1].integration_owner='owner';
 const owner=member('owner',['contracts'],['reviewer']);owner.integration_owner=['contracts'];
 const team={schema_version:1,artifact_kind:'team',project_id:project.project_id,revision:1,updated_at:stamp,updated_by:clone(actor),membership_source:clone(project.membership_source),
  members:[member('alice',['backend','contracts']),member('coord',[],['coordinator']),owner]};
 const context={schema_version:1,observed_at:stamp,evaluated_at:'2026-10-29T00:15:00Z',freshness_limit_seconds:3600,recorded_by:clone(actor),source:clone(ref),
  principal:{credential_kind:'human',authenticated_login:'alice',on_behalf_of:null,evidence:clone(ref),delegation:{state:'unknown',evidence:null}},
  request:{mode:'candidate',issue_ref:'https://github.com/example/project/issues/42',work_id:'issue-42',human_owner:'alice',area_ids:['backend'],assignees:[],
   responsibility_confirmation:{state:'unknown',evidence:null},owner_overrides:[]},
  member_facts:team.members.map(m=>fact(m.github_login)),claims_inventory_status:'complete',active_claims:[]};
 return bind({project,team,context});
}
export function claim(n=1,owner='alice') {return {claim_id:'claim-'+n,issue_ref:'https://github.com/example/project/issues/'+n,work_id:'issue-'+n,human_owner:owner,evidence:clone(ref)};}
export function assigned(i=input()) {i.context.request.mode='assigned_owner';i.context.request.assignees=['alice'];i.context.request.responsibility_confirmation={state:'confirmed',evidence:clone(ref)};return i;}
export function override(i=input(),login='alice') {i.context.request.area_ids=['contracts'];i.context.request.owner_overrides=[{area_id:'contracts',github_login:login,issue_ref:i.context.request.issue_ref,work_id:i.context.request.work_id,approval:clone(approval)}];return i;}
export function areaCoordinators(i=input()) {
 i.project.coordinators={scope:'area',assignments:[{github_login:'coord',area_ids:['backend']},{github_login:'owner',area_ids:['contracts']}]};
 i.team.members[1].areas=['backend'];i.team.members[2].roles.push('coordinator');return bind(i);
}
export function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
