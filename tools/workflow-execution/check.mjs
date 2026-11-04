import { validateExecutionArtifact } from './schema.mjs';
import { inspectJson, countLimit, arrays, MAX_RESULT } from './limits.mjs';
import { hash, same, records, recordKinds, referenceKinds, identity, key, matches, within, subjectOf } from './bindings.mjs';
import { inspectFindings } from './findings.mjs';
import { codes } from './messages.mjs';
const not_evaluated=['approval_authenticity','actual_execution','reference_authenticity','history_completeness','semantic_correctness','isolation_atomicity','other_issue_completion','runtime_budget_enforcement'];
const allowed=['profile','grant','context',...arrays,'report','events','previous'];
function shape(s,previous=false){return s&&typeof s==='object'&&!Array.isArray(s)&&Object.keys(s).every(k=>allowed.includes(k)&&(!previous||k!=='previous'))&&['profile','grant','context',...arrays].every(k=>Object.hasOwn(s,k))&&arrays.every(k=>Array.isArray(s[k]))&&(!Object.hasOwn(s,'events')||Array.isArray(s.events))&&(!Object.hasOwn(s,'report')||s.report!==null)&&(!Object.hasOwn(s,'previous')||s.previous!==null);}
export function checkExecutionEvidence(input){
 const diagnostics=[],checks=[];let capped=false,input_digest=null,evaluated_at=null,invalid=false;
 const add=(code,artifact_kind='input',index=0)=>{if(!codes.has(code))throw Error('unknown_diagnostic');if(diagnostics.length>=999){capped=true;return;}diagnostics.push({code,artifact_kind,index});};
 const pushCheck=value=>{if(checks.length>=1000){capped=true;return;}checks.push(value);};
 const finish=()=>{
  if(capped)diagnostics.push({code:'diagnostic_limit',artifact_kind:'input',index:0});
  const unique=[...new Map(diagnostics.map(d=>[JSON.stringify(d),d])).values()];
  unique.sort((a,b)=>a.code<b.code?-1:a.code>b.code?1:a.artifact_kind<b.artifact_kind?-1:a.artifact_kind>b.artifact_kind?1:a.index-b.index);
  const exceptionOnly=unique.length&&unique.every(x=>x.code==='human_exception');
  const result={schema_version:1,artifact_kind:'result',checker_version:'1.0.0',input_digest,evaluated_at,status:unique.length?'blocked':'pass',decision:invalid?'invalid':exceptionOnly?'human_review':unique.length?'needs_work':'evidence_complete',checks,diagnostics:unique,not_evaluated:[...not_evaluated]};
  if(Buffer.byteLength(JSON.stringify(result))>MAX_RESULT){result.status='blocked';result.decision='invalid';result.checks=[];result.diagnostics=[{code:'output_limit',artifact_kind:'input',index:0}];}
  return result;
 };
 const dataError=inspectJson(input);if(dataError){add(dataError);invalid=true;return finish();}
 if(!shape(input)||(input.previous!==undefined&&!shape(input.previous,true))){add('input_invalid');invalid=true;return finish();}
 if(countLimit(input)){add('input_limit');invalid=true;return finish();}
 input_digest=hash(input);
 for(const s of [input,...(input.previous?[input.previous]:[])]){
  for(const k of ['profile','grant','context'])if(!validateExecutionArtifact(k,s[k]).valid)add('schema_invalid',k);
  for(const [k,kind]of Object.entries(recordKinds))for(const [i,r]of (s[k]??[]).entries())if(!validateExecutionArtifact(kind,r).valid)add('schema_invalid',kind,i);
  if(s.report!==undefined&&!validateExecutionArtifact('run-report',s.report).valid)add('schema_invalid','run-report');
 }
 if(diagnostics.length){invalid=true;return finish();}
 const {profile:p,grant:g,context:c}=input,now=Date.parse(c.evaluated_at);
 const timestamps=[input];while(timestamps.length){const value=timestamps.pop();if(!value||typeof value!=='object')continue;for(const [k,v]of Object.entries(value)){if(/(?:^|_)at$/.test(k)&&typeof v==='string'&&!Number.isFinite(Date.parse(v))){add('time_invalid');invalid=true;}else if(v&&typeof v==='object')timestamps.push(v);}}
 if(invalid)return finish();evaluated_at=c.evaluated_at;
 const current=records(input),old=input.previous?records(input.previous):[],map=new Map(),digests=new Map();
 for(const r of current){const id=identity(r);if(map.has(id))add('duplicate_record',r.artifact_kind);else map.set(id,r);}
 for(const r of old){const found=map.get(identity(r));if(found&&!same(r,found))add('history_changed',r.artifact_kind);else if(!found){add('history_missing',r.artifact_kind);map.set(identity(r),r);}}
 for(const [id,r]of map)digests.set(id,hash(r));
 const lookup=ref=>{const r=map.get(key(ref));return r&&ref.digest===digests.get(key(ref))?r:undefined;};
 // Resolve only supplied internal records; source locations stay opaque.
 for(const r of [...current,c]){const stack=[r];while(stack.length){const v=stack.pop();if(!v||typeof v!=='object')continue;if(referenceKinds.has(v.kind)&&v.id&&v.digest){if(!map.has(key(v)))add('reference_missing',r.artifact_kind);else if(!lookup(v))add('reference_mismatch',r.artifact_kind);}for(const child of Object.values(v))if(child&&typeof child==='object')stack.push(child);}}
 for(const r of current){if(r.repository!==c.repository)add('binding_mismatch',r.artifact_kind);if(Date.parse(r.recorded_at)>now)add('time_invalid',r.artifact_kind);}
 const fresh=t=>Date.parse(t)<=now&&now-Date.parse(t)<=p.max_age_seconds*1000;
 const policyChecks=new Map(),commandIds=new Set(),acs=new Set();
 for(const cmd of p.commands){if(commandIds.has(cmd.command_id))add('policy_invalid','profile');commandIds.add(cmd.command_id);}
 for(const def of p.checks){if(policyChecks.has(def.check_id))add('policy_invalid','profile');policyChecks.set(def.check_id,def);if(def.kind==='verification'&&(!commandIds.has(def.command_id)||def.test_check&&!(def.min_tests>=1)))add('policy_invalid','profile');for(const ac of def.acs)acs.add(ac);}
 if(p.required_acs.some(ac=>!acs.has(ac))||!p.review_required&&(p.risk!=='low'||!p.review_omission_reason.trim())||!p.stop_severities.includes('critical')||!p.stop_severities.includes('high'))add('policy_invalid','profile');
 const facts=new Map();for(const fact of c.facts){if(facts.has(fact.fact_id))add('duplicate_record','context');facts.set(fact.fact_id,fact);if(!fresh(fact.observed_at))add('evidence_stale','context');}
 for(const id of ['identity','authority','inventory','approval','assignment','ready'])if(facts.get(id)?.value!==true)add('authorization_invalid','context');
 const owner=p.human_owner,requestActor=g.request.actor,requestOwner=requestActor.actor_ref;
 if(c.human_owner!==owner||g.human_owner!==owner||requestActor.actor_type!=='human'||![owner,...p.delegates].includes(requestOwner)||g.revoked||Date.parse(g.issued_at)>now||Date.parse(g.expires_at)<=now||Date.parse(g.issued_at)>=Date.parse(g.expires_at)||now-Date.parse(g.issued_at)>p.limits.run_seconds*1000||p.limits.cost.status!=='known')add('authorization_invalid','grant');
 if(!matches(g.profile,p)||!matches(c.subject.profile,p)||!matches(c.grant,g)||g.run_id!==c.subject.run_id||c.subject.attempt>p.limits.max_repairs+1||g.selected.length>p.limits.max_issues)add('binding_mismatch','grant');
 const selected=new Map();for(const t of g.selected){if(selected.has(t.issue_number))add('duplicate_record','grant');selected.set(t.issue_number,t);if(t.work_id!=='issue-'+t.issue_number||t.run_id!==g.run_id||!matches(t.profile,p)||t.stages.some(x=>!p.allowed_stages.includes(x))||t.allowed_paths.some(x=>!within(x,p.allowed_paths)||within(x,p.forbidden_paths))||p.forbidden_paths.some(x=>!t.forbidden_paths.includes(x))||t.attempt>p.limits.max_repairs+1||g.requested_issues&&!g.requested_issues.includes(t.issue_number))add('authorization_invalid','grant');}
 const t=selected.get(c.subject.issue_number);
 if(!t||!same(subjectOf(t),c.subject)||t.contract_digest!==c.contract_digest||t.design_digest!==c.design_digest||!t.stages.includes(c.stage)||!same(t.allowed_paths,c.allowed_paths)||!same(t.forbidden_paths,c.forbidden_paths))add('binding_mismatch','context');
 const relevant=r=>r.subject&&same(r.subject,c.subject)&&r.repository===c.repository;
 const temporal=(r,index)=>{
  if(Date.parse(r.started_at)>Date.parse(r.finished_at)||Date.parse(r.finished_at)>Date.parse(r.recorded_at)||Date.parse(r.started_at)<Date.parse(g.issued_at))add('time_invalid',r.artifact_kind,index);
  if(!fresh(r.finished_at))add('evidence_stale',r.artifact_kind,index);
 };
 const outcome=(r,kind,index)=>{pushCheck({check_kind:kind,index,status:r.status});if(r.status!=='passed')add({failed:'evidence_failed',error:'evidence_error',not_evaluated:'evidence_not_evaluated'}[r.status],kind,index);};
 const pick=(rows,kind,checkId)=>{
  const eligible=rows.filter(r=>kind==='integration-result'?r.run_id===g.run_id&&matches(r.profile,p):relevant(r)).filter(r=>!checkId||r.check_id===checkId);
  eligible.sort((a,b)=>((b.subject?.attempt??0)-(a.subject?.attempt??0))||Date.parse(b.finished_at)-Date.parse(a.finished_at));
  if(eligible.length>1&&eligible[0].finished_at===eligible[1].finished_at&&!same(eligible[0],eligible[1]))add('duplicate_record',kind);
  return eligible[0];
 };
 const latestVerifications=[],activeAcs=new Set();
 for(const [index,def]of p.checks.entries()){
  if(def.when){const fact=facts.get(def.when.fact_id);if(!fact||fact.value==='unknown'){pushCheck({check_kind:'condition',index,status:'not_evaluated'});add('condition_unknown','profile',index);continue;}if(fact.value!==def.when.equals){pushCheck({check_kind:'condition',index,status:'not_evaluated'});continue;}}
  for(const ac of def.acs)activeAcs.add(ac);
  const rows=def.kind==='verification'?input.verifications:def.kind==='security-result'?input.securityResults:input.integrationResults;
  const r=pick(rows,def.kind,def.kind==='integration-result'?null:def.check_id);
  if(!r){pushCheck({check_kind:def.kind,index,status:'not_evaluated'});add('evidence_missing',def.kind,index);continue;}
  temporal(r,index);outcome(r,def.kind,index);
  if(def.kind==='verification'){
   latestVerifications.push(r);
   if(r.command_id!==def.command_id||r.domain!==def.domain||def.acs.some(ac=>!r.acs.includes(ac))||r.status==='passed'&&(r.exit_code!==0||def.test_check&&r.test_count<def.min_tests))add('execution_invalid','verification',index);
   if(r.scope.some(x=>!within(x,c.allowed_paths)||within(x,c.forbidden_paths)))add('scope_invalid','verification',index);
  }else if(def.kind==='security-result'){
   if(!r.supported||!fresh(r.database_fetched_at)||Date.parse(r.database_fetched_at)>Date.parse(r.started_at))add('evidence_stale',def.kind,index);
  }else{
   if(r.main_sha!==c.subject.base_sha||!same(r.targets,c.integration_targets)||new Set(r.targets.map(x=>x.issue_number)).size!==r.targets.length||!r.targets.some(x=>x.issue_number===c.subject.issue_number&&x.head_sha===c.subject.head_sha&&x.plan_digest===c.subject.plan.digest))add('integration_invalid',def.kind,index);
  }
 }
 if(p.required_acs.some(ac=>!activeAcs.has(ac)))add('policy_invalid','profile');
 // Validate every current-subject review receipt, so an unresolved finding cannot disappear behind a later summary.
 const currentReviews=input.reviews.filter(relevant);
 for(const [index,r]of currentReviews.entries()){
  temporal(r,index);
  if(r.execution_status!=='completed'||r.implementer.context_id===r.reviewer.context_id||same(r.implementer.actor,r.reviewer.actor)||r.reviewer.actor.actor_type!=='ai_agent')add('review_invalid','review',index);
  if(!r.verification_refs.length||r.verification_refs.some(x=>{const v=lookup(x);return v?.artifact_kind!=='verification'||!relevant(v)||v.status!=='passed'||Date.parse(v.finished_at)>Date.parse(r.started_at);}))add('review_invalid','review',index);
 }
 if(p.review_required){const review=pick(input.reviews,'review');if(review&&latestVerifications.some(v=>!review.verification_refs.some(x=>matches(x,v))))add('review_invalid','review');if(!review){pushCheck({check_kind:'review',index:0,status:'not_evaluated'});add('evidence_missing','review');}else outcome(review,'review',0);}
 const findingRecords=[...input.reviews,...input.securityResults].filter(r=>r.subject.issue_number===c.subject.issue_number&&r.subject.run_id===c.subject.run_id);
 const latestFindings=new Map();for(const r of findingRecords){const ids=new Set();for(const f of r.findings){if(ids.has(f.finding_id))add('duplicate_record',r.artifact_kind);ids.add(f.finding_id);const old=latestFindings.get(f.finding_id);const order=old?(r.subject.attempt-old.r.subject.attempt||Date.parse(r.finished_at)-Date.parse(old.r.finished_at)):1;if(order>0)latestFindings.set(f.finding_id,{r,f});else if(order===0&&!same(f,old.f))add('duplicate_record',r.artifact_kind);}}
 for(const [index,{r,f}]of [...latestFindings.values()].entries())inspectFindings(r,{profile:p,context:c,lookup,latestVerifications,add,findings:[f],findingRecords},index);
 for(const [index,r]of [...input.verifications,...input.reviews,...input.securityResults].entries()){
  const target=selected.get(r.subject.issue_number);
  if(!target||r.subject.work_id!=='issue-'+r.subject.issue_number||r.subject.run_id!==g.run_id)add('binding_mismatch',r.artifact_kind,index);
  // Current Issue mismatches are archived receipts, never accepted as current evidence.
 }
 const eventIds=new Set();for(const [index,e]of (input.events??[]).entries()){
  const eventKey=e.operation_id+'|'+e.status;if(eventIds.has(eventKey))add('event_invalid','event',index);eventIds.add(eventKey);
  if(e.run_id!==g.run_id||!matches(e.profile,p)||!selected.has(e.issue_number)||Date.parse(e.occurred_at)>now||['claim','push','release','stop'].includes(e.operation_kind)&&(!e.claim_id||!e.worker_id||!e.generation))add('event_invalid','event',index);
 }
 if(input.report){const r=input.report,ids=new Set();if(r.run_id!==g.run_id||!matches(r.profile,p)||!matches(r.grant,g)||Date.parse(r.started_at)>Date.parse(r.finished_at)||Date.parse(r.finished_at)>now)add('report_invalid','run-report');for(const row of r.subjects){if(ids.has(row.issue_number)||!selected.has(row.issue_number)||row.head_sha!==selected.get(row.issue_number)?.head_sha)add('report_invalid','run-report');ids.add(row.issue_number);}if(new Set(r.recommended_merge_order).size!==r.recommended_merge_order.length||r.recommended_merge_order.some(i=>!ids.has(i)))add('report_invalid','run-report');}
 return finish();
}
