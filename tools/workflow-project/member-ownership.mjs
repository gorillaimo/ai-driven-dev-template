import { compare } from 'workflow-rules/resolve';
import { attachConflicts } from './graph.mjs';
export const fold=value=>value.toLowerCase();
export const membershipSource=s=>({type:s.type,organization_team:s.organization_team?{organization:fold(s.organization_team.organization),team_slug:s.organization_team.team_slug}:null});
export function issueMatches(issue,work,repository) {
  const m=/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/([1-9][0-9]*)$/.exec(issue);
  return !!m&&fold(m[1])===fold(repository)&&work==='issue-'+m[2];
}

export function inspectMemberConfiguration(project,team,request,add) {
  const members=new Map(),areas=new Map(),coordinatorForArea=new Map(),assignments=new Set();
  for(const [n,m] of team.members.entries()) {
    const login=fold(m.github_login);if(members.has(login))add('duplicate_member','team/members/'+n,login);members.set(login,m);
  }
  for(const [n,a] of project.areas.entries()){if(areas.has(a.area_id))add('duplicate_area','project/areas/'+n,null,a.area_id);areas.set(a.area_id,a);}
  for(const [n,m] of team.members.entries())for(const id of [...m.areas,...m.integration_owner])if(!areas.has(id))add('unknown_area','team/members/'+n,fold(m.github_login),id);
  for(const id of request.area_ids)if(!areas.has(id))add('unknown_area','context/request/area_ids',null,id);
  const scope=project.coordinators.scope;
  for(const [n,c] of project.coordinators.assignments.entries()) {
    const login=fold(c.github_login),m=members.get(login),path='project/coordinators/assignments/'+n;
    if(assignments.has(login))add('duplicate_coordinator',path,login);assignments.add(login);
    if(!m)add('member_missing',path,login);
    else if(!m.active||!m.roles.includes('coordinator'))add('coordinator_invalid',path,login);
    const ids=scope==='project'?[...areas.keys()]:c.area_ids;
    for(const id of ids){
      if(!areas.has(id))add('unknown_area',path,login,id);
      if(coordinatorForArea.has(id))add('coordinator_coverage',path,login,id);
      coordinatorForArea.set(id,login);
      if(scope==='area'&&m&&!m.areas.includes(id))add('coordinator_area_missing',path,login,id);
    }
  }
  for(const id of areas.keys())if(!coordinatorForArea.has(id))add('coordinator_coverage','project/coordinators',null,id);
  if(scope==='area') {
    const ids=[...areas.keys()].sort(compare),graph=attachConflicts({areas,features:new Map(ids.map(id=>[id,{area_ids:[id]}]))});
    for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++)if(coordinatorForArea.get(ids[a])!==coordinatorForArea.get(ids[b])&&graph.conflicts(ids[a],ids[b]))add('coordinator_scope_overlap','project/coordinators',null,ids[a]);
  }
  for(const [id,a] of areas)if(a.integration_owner) {
    const login=fold(a.integration_owner),m=members.get(login);
    if(!m)add('member_missing','project/areas',login,id);
    else if(!m.active||!m.areas.includes(id)||!m.integration_owner.includes(id))add('owner_invalid','project/areas',login,id);
  }
  for(const [login,m] of members)for(const id of m.integration_owner)if(areas.has(id)&&fold(areas.get(id).integration_owner??'')!==login)add('owner_declaration_mismatch','team/members',login,id);
  const assignees=new Set();for(const login of request.assignees){const key=fold(login);if(assignees.has(key))add('duplicate_assignee','context/request/assignees',key);assignees.add(key);}
  return {members,areas,coordinatorForArea,assignees};
}

export function inspectMemberFacts(context,model,add) {
  const facts=new Map();
  for(const [n,f] of context.member_facts.entries()) {
    const login=fold(f.github_login),path='context/member_facts/'+n;
    if(!model.members.has(login))add('unknown_fact',path,login);
    if(facts.has(login))add('duplicate_fact',path,login);facts.set(login,f);
  }
  return facts;
}

const ranks=['read','triage','write','maintain','admin'];
export function evaluateMember(login,project,model,facts,add,path,requiredAreas=[]) {
  let status='pass';
  const fail=(code,kind='ineligible',area=null)=>{if(status!=='unknown')status=kind==='unknown'?'unknown':'blocked';add(code,path,login,area,kind);};
  const m=model.members.get(login),f=facts.get(login);
  if(!m){fail('member_missing');return 'blocked';}
  if(!m.active)fail('member_inactive');
  for(const id of requiredAreas)if(!m.areas.includes(id))fail('member_area_missing','ineligible',id);
  if(!f){fail('member_fact_missing','unknown');return 'unknown';}
  if(f.account_type==='unknown')fail('account_unknown','unknown');else if(f.account_type!=='human')fail('account_not_human');
  const access=f.repository_access;
  if(access.state==='denied')fail('repository_denied');
  else if(access.state!=='confirmed'||!ranks.includes(access.permission))fail('permission_unknown','unknown');
  else if(ranks.indexOf(access.permission)<ranks.indexOf(project.required_repository_permission))fail('permission_insufficient');
  const expected=project.membership_source.organization_team,actual=f.organization_team;
  if(expected){
    if(actual.state==='not_member')fail('team_not_member');
    else if(actual.state!=='member')fail('team_unknown','unknown');
    else if(fold(actual.organization??'')!==fold(expected.organization)||actual.team_slug!==expected.team_slug)fail('team_mismatch');
  }
  return status;
}

export function inspectOwnership(project,context,model,facts,add) {
  const {request}=context,groups=new Map(),owners=[],overrides=new Map();
  for(const id of [...request.area_ids].sort(compare)) {
    const login=model.coordinatorForArea.get(id);
    if(!groups.has(login))groups.set(login,[]);groups.get(login).push(id);
  }
  const coordinators=[...groups.entries()].sort(([a],[b])=>compare(a,b)).map(([github_login,area_ids])=>({github_login,area_ids,
    status:evaluateMember(github_login,project,model,facts,add,'project/coordinators')}));
  for(const [n,o] of request.owner_overrides.entries()) {
    const path='context/request/owner_overrides/'+n,login=fold(o.github_login),coord=model.coordinatorForArea.get(o.area_id);
    if(overrides.has(o.area_id))add('duplicate_override',path,login,o.area_id);
    overrides.set(o.area_id,o);
    if(!request.area_ids.includes(o.area_id)||!issueMatches(o.issue_ref,o.work_id,project.repository)||fold(o.issue_ref)!==fold(request.issue_ref)||o.work_id!==request.work_id)add('override_scope_mismatch',path,login,o.area_id);
    if(fold(o.approval.approved_by)!==coord||o.approval.approval_type!=='integration_owner_override'||!Number.isFinite(Date.parse(o.approval.approved_at))||Date.parse(o.approval.approved_at)>Date.parse(context.observed_at))add('override_approval_invalid',path,login,o.area_id,'ineligible');
  }
  for(const id of [...request.area_ids].sort(compare)) {
    const o=overrides.get(id),login=o?fold(o.github_login):model.areas.get(id).integration_owner?fold(model.areas.get(id).integration_owner):null;
    if(login)owners.push({area_id:id,github_login:login,source:o?'override':'default',status:evaluateMember(login,project,model,facts,add,'context/request/owner_overrides',[id])});
  }
  return {coordinators,integration_owners:owners};
}
