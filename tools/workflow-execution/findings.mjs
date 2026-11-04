import { same, matches, findingOrigin, hash } from './bindings.mjs';
export function inspectFindings(record,{profile,context,lookup,latestVerifications,add,findings=record.findings,findingRecords=[]},index){
 const kind=record.artifact_kind,now=Date.parse(context.evaluated_at),ids=new Set();
 for(const f of findings){
  if(ids.has(f.finding_id)){add('duplicate_record',kind,index);continue;}ids.add(f.finding_id);
  if(!same(f.subject,record.subject)){add('binding_mismatch',kind,index);continue;}
  if(f.status==='disputed'){add('finding_disputed',kind,index);continue;}
  if(f.status==='open'){
   if(f.required_ac||f.category==='defect'&&profile.stop_severities.includes(f.severity))add('finding_open',kind,index);
   if(f.resolution||f.exception)add('resolution_invalid',kind,index);
   continue;
  }
  if(f.status==='accepted_risk'){
   const e=f.exception,accepted=e&&same(f.subject,context.subject)&&e.actor.actor_type==='human'&&[profile.human_owner,...profile.delegates].includes(e.actor.actor_ref)&&e.reason.trim()&&e.issue_number===f.subject.issue_number&&e.head_sha===f.subject.head_sha&&e.finding_id===f.finding_id&&e.finding_digest===findingOrigin(f)&&Date.parse(e.issued_at)<=now&&now<Date.parse(e.expires_at)&&Date.parse(e.issued_at)<Date.parse(e.expires_at)&&!f.resolution;
   add(accepted?'human_exception':'exception_invalid',kind,index);continue;
  }
  const r=f.resolution,recheck=r&&lookup(r.review_ref),verified=r?.verification_refs.map(lookup);
  const origins=findingRecords.flatMap(x=>x.findings).filter(x=>x.finding_id===f.finding_id&&x!==f);
  const originOK=r&&(origins.length?origins.some(x=>findingOrigin(x)===r.finding_digest):r.finding_digest===findingOrigin(f));
  const valid=r&&originOK&&!f.exception&&same(f.subject,context.subject)&&r.head_sha===f.subject.head_sha&&r.attempt===f.subject.attempt&&recheck?.artifact_kind==='review'&&recheck!==record&&matches(r.review_ref,recheck)&&same(recheck.subject,record.subject)&&recheck.execution_status==='completed'&&recheck.status==='passed'&&recheck.reviewer.context_id!==record.implementer?.context_id&&recheck.reviewer.context_id!==recheck.implementer.context_id&&Date.parse(recheck.started_at)>=Date.parse(record.finished_at)&&recheck.rechecks?.some(x=>x.finding_id===f.finding_id&&x.finding_digest===r.finding_digest)&&verified?.length&&verified.every(v=>v?.artifact_kind==='verification'&&v.status==='passed'&&v.exit_code===0&&same(v.subject,record.subject)&&Date.parse(v.finished_at)<=Date.parse(recheck.started_at)&&latestVerifications.some(l=>hash(l)===hash(v)));
  if(!valid)add('resolution_invalid',kind,index);
 }
}
