import { canonical,digest,compare } from 'workflow-rules/resolve';
import { inspectJson,MAX_RESULT } from './limits.mjs';
import { memberLimits } from './member-limits.mjs';
import { validateMemberArtifact } from './member-schema.mjs';
import { memberMessages } from './member-messages.mjs';
import { fold,membershipSource,issueMatches,inspectMemberConfiguration,inspectMemberFacts,evaluateMember,inspectOwnership } from './member-ownership.mjs';
import { inspectCapacity } from './member-capacity.mjs';

function inspectPrincipal(context,model,add) {
  const p=context.principal,r=context.request,login=fold(r.human_owner),path='context/principal';
  if(p.credential_kind==='unknown'||!p.authenticated_login||!p.evidence){add('principal_unknown',path,login,null,'unknown');return;}
  if(p.credential_kind==='human') {
    if(fold(p.authenticated_login)!==login||(p.on_behalf_of&&fold(p.on_behalf_of)!==login))add('principal_mismatch',path,login,null,'ineligible');
  } else {
    if(!p.on_behalf_of)add('delegation_unknown',path,login,null,'unknown');
    if(p.delegation.state==='denied')add('delegation_denied',path,login,null,'ineligible');
    else if(p.delegation.state==='unknown'||!p.delegation.evidence)add('delegation_unknown',path,login,null,'unknown');
    if((p.on_behalf_of&&fold(p.on_behalf_of)!==login)||model.members.has(fold(p.authenticated_login)))add('principal_mismatch',path,login,null,'ineligible');
  }
  if((r.mode==='assigned_owner'||r.assignees.length)&&!model.assignees.has(login))add('assignee_mismatch','context/request/assignees',login,null,'ineligible');
  if(r.mode==='assigned_owner') {
    const c=r.responsibility_confirmation;
    if(c.state==='denied')add('responsibility_denied','context/request/responsibility_confirmation',login,null,'ineligible');
    else if(c.state!=='confirmed'||!c.evidence)add('responsibility_unknown','context/request/responsibility_confirmation',login,null,'unknown');
  }
}

export function checkProjectMembers(input) {
  const diagnostics=[],checks=[];let cap=null,bytes=0,input_digest=null,schemaOK=false,usable=false;
  const add=(code,path='',github_login=null,area_id=null,kind='invalid')=>{
    if(!memberMessages[code])throw Error('unknown_member_diagnostic');if(cap)return;
    if(diagnostics.length>=999){cap='diagnostic_limit';return;}
    const d={code,kind,path,github_login,area_id};bytes+=Buffer.byteLength(canonical(d));
    if(bytes>MAX_RESULT/2){cap='output_limit';return;}diagnostics.push(d);
  };
  const check=(check_id,fn)=>{const before=diagnostics.length;fn();checks.push({check_id,status:diagnostics.length===before&&!cap?'pass':'block'});};
  let project_digest=null,team_digest=null,capacity=null,coordinators=[],integration_owners=[];
  check('input',()=>{
    const error=inspectJson(input);if(error){add(error);return;}
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['project','team','context'].includes(k))){add('input_invalid');return;}
    if(memberLimits(input)){add('input_limit');return;}input_digest=digest(canonical(input));usable=true;
  });
  if(usable)check('schema',()=>{
    for(const kind of ['project','team','context'])if(!validateMemberArtifact(kind,input[kind]).valid)add('schema_invalid',kind);
    schemaOK=!diagnostics.length;
  });
  if(schemaOK) {
    const {project:p,team:t,context:c}=input;project_digest=digest(canonical(p));team_digest=digest(canonical(t));
    check('identity',()=>{
      if(p.project_id!==t.project_id)add('identity_mismatch','team/project_id');
      if(c.project_id!==p.project_id||fold(c.repository)!==fold(p.repository)||c.project_revision!==p.revision||c.team_revision!==t.revision||c.project_digest!==project_digest||c.team_digest!==team_digest)add('context_mismatch','context');
      if(canonical(membershipSource(p.membership_source))!==canonical(membershipSource(t.membership_source)))add('membership_source_mismatch','team/membership_source');
      if(!issueMatches(c.request.issue_ref,c.request.work_id,p.repository))add('issue_identity_mismatch','context/request');
      const observed=Date.parse(c.observed_at),evaluated=Date.parse(c.evaluated_at),projectTime=Date.parse(p.updated_at),teamTime=Date.parse(t.updated_at);
      if(![observed,evaluated,projectTime,teamTime].every(Number.isFinite))add('snapshot_time_invalid','context',null,null,'unknown');
      else {
        if(observed>evaluated)add('snapshot_future','context/observed_at',null,null,'unknown');
        if(evaluated-observed>c.freshness_limit_seconds*1000)add('snapshot_stale','context/observed_at',null,null,'unknown');
        if(observed<projectTime||observed<teamTime)add('snapshot_before_configuration','context/observed_at',null,null,'unknown');
      }
    });
    let model,facts;
    check('configuration',()=>{model=inspectMemberConfiguration(p,t,c.request,add);});
    check('facts',()=>{facts=inspectMemberFacts(c,model,add);});
    if(!diagnostics.some(d=>d.kind==='invalid')&&!cap) {
      check('principal',()=>inspectPrincipal(c,model,add));
      check('subject',()=>{
        const login=fold(c.request.human_owner),m=model.members.get(login);
        evaluateMember(login,p,model,facts,add,'context/request/human_owner',c.request.area_ids);
        if(m&&!m.roles.includes('developer'))add('role_missing','team/members/roles',login,null,'ineligible');
      });
      check('ownership',()=>{({coordinators,integration_owners}=inspectOwnership(p,c,model,facts,add));});
      check('capacity',()=>{capacity=inspectCapacity(p,c,model,add);});
    }
  }
  if(cap)diagnostics.push({code:cap,kind:'invalid',path:'',github_login:null,area_id:null});
  const result={schema_version:1,checker_version:'1.0.0',input_digest,project_id:schemaOK?input.project.project_id:null,
    project_revision:schemaOK?input.project.revision:null,team_revision:schemaOK?input.team.revision:null,project_digest,team_digest,
    observed_at:schemaOK?input.context.observed_at:null,evaluated_at:schemaOK?input.context.evaluated_at:null,status:diagnostics.length?'blocked':'pass',checks,
    subject:{github_login:schemaOK?fold(input.context.request.human_owner):null,mode:schemaOK?input.context.request.mode:null,
      qualification:diagnostics.length?(diagnostics.some(d=>d.kind==='invalid'||d.kind==='unknown')?'unknown':'ineligible'):'eligible',
      reasons:[...new Set(diagnostics.map(d=>d.code))].sort(compare)},coordinators,integration_owners,capacity,
    diagnostics:[...new Map(diagnostics.map(d=>[canonical(d),d])).values()].sort((a,b)=>compare(canonical(a),canonical(b))),
    not_evaluated:['live_github_and_evidence_authenticity','actual_time_and_inventory_completeness','issue_contract_and_ready_for_ai','workflow_approvals','plan_dependencies','actual_scope_conflicts','atomic_claim','actual_work_execution']};
  if(Buffer.byteLength(canonical(result))>MAX_RESULT){
    Object.assign(result,{status:'blocked',coordinators:[],integration_owners:[],capacity:null,diagnostics:[{code:'output_limit',kind:'invalid',path:'',github_login:null,area_id:null}]});
    result.subject.qualification='unknown';result.subject.reasons=['output_limit'];result.checks.push({check_id:'output',status:'block'});
  }
  if(!validateMemberArtifact('result',result).valid)throw Error('invalid_member_result');return result;
}
