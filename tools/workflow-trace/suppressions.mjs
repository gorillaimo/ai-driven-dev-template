import { canonical, digest } from 'workflow-rules/resolve';
export function subjectDigest(input){
 const copy=structuredClone(input);
 delete copy.traceability.checks;delete copy.traceability.suppressions;
 delete copy.context.suppression_scopes;delete copy.context.evaluated_at;
 return digest(canonical({checker_version:'1.0.0',...copy}));
}
export function applySuppressions(input,findings,subject,add){
 const {traceability,context}=input,seen=new Set(),scopes=context.suppression_scopes;
 for(const scope of scopes) if(!traceability.suppressions.some(s=>s.check_id===scope.check_id)) add('suppression_invalid','context/suppression_scopes',scope.node,scope.edge,true);
 for(const s of traceability.suppressions){
  const targets=scopes.filter(scope=>scope.check_id===s.check_id),f=findings.find(d=>d.check_id===s.check_id),scope=targets[0];
  const invalid=seen.has(s.check_id)||targets.length!==1||!f||f.protected||!s.reason.trim()||
   Date.parse(s.expires_at)<=Date.parse(context.evaluated_at)||Date.parse(s.approval.approved_at)>Date.parse(context.evaluated_at)||
   s.approval.approval_type!=='suppression'||scope?.subject_digest!==subject||scope?.plan_revision!==context.plan_revision||scope?.boundary!==context.boundary||
   scope?.node!==f?.node||canonical(scope?.edge)!==canonical(f?.edge)||scope?.path!==f?.path||
   !context.external_confirmations.some(c=>canonical(c.reference)===canonical(s.approval.reference)&&c.confirmed_by===s.approval.approved_by&&Date.parse(c.confirmed_at)<=Date.parse(context.evaluated_at));
  seen.add(s.check_id);
  if(invalid) add('suppression_invalid','traceability/suppressions',f?.node??null,f?.edge??null,true);
  else f.suppressed=true;
 }
}
