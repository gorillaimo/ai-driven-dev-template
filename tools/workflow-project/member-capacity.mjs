import { fold,issueMatches } from './member-ownership.mjs';
export function inspectCapacity(project,context,model,add) {
  const counts=new Map(),ids=new Set(),issues=new Map(),works=new Set();let valid=true;
  for(const [n,c] of context.active_claims.entries()) {
    const login=fold(c.human_owner),issue=fold(c.issue_ref),path='context/active_claims/'+n;
    if(!issueMatches(c.issue_ref,c.work_id,project.repository)){add('issue_identity_mismatch',path,login);valid=false;}
    if(ids.has(c.claim_id)||issues.has(issue)||works.has(c.work_id)){add('duplicate_claim',path,login);valid=false;}
    if(!model.members.has(login)){add('claim_member_missing',path,login);valid=false;}
    ids.add(c.claim_id);issues.set(issue,login);works.add(c.work_id);counts.set(login,(counts.get(login)??0)+1);
  }
  if(context.claims_inventory_status!=='complete'){add('claims_inventory_unknown','context/claims_inventory_status',null,null,'unknown');return null;}
  if(!valid)return null;
  const request=context.request,login=fold(request.human_owner),member=model.members.get(login),holder=issues.get(fold(request.issue_ref));
  if(!member)return null;
  if(holder&&holder!==login)add('claim_owner_mismatch','context/active_claims',login,null,'ineligible');
  if(holder&&request.mode==='candidate')add('issue_already_claimed','context/active_claims',login,null,'ineligible');
  const active_count=counts.get(login)??0,additional_count=request.mode==='assigned_owner'&&holder===login?0:1,limit=member.max_concurrent_issues;
  if(active_count+additional_count>limit)add('capacity_exceeded','team/members/max_concurrent_issues',login,null,'ineligible');
  return {active_count,additional_count,limit};
}
