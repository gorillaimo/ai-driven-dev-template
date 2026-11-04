import {scannerArgv} from './commands.mjs';
import {inspectJson} from './limits.mjs';
import {validateSecurityArtifact as validate} from './schema.mjs';
import {validateExecutionArtifact} from 'workflow-execution/schema';
import {planSecurityChecks} from './plan.mjs';
import {hash,same,snapshots,fresh,diag,maxDiagnostics,finiteTimes} from './core.mjs';
export function checkSecurityEvidence(input){
 const report={schema_version:1,artifact_kind:'security-report',status:'blocked',decision:'invalid',input_digest:null,checks:[],diagnostics:[],not_evaluated:['approval_authenticity','history_completeness','application_security_guarantee','external_agent_runner','protected_storage_permissions','container_image_vulnerabilities','live_dynamic_scan','real_llm_security']};
 const add=(code,index=0)=>report.diagnostics.push(diag(code,index));
 const bad=inspectJson(input);if(bad){add(bad);return report;}
 if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['profile','executionProfile','context','catalog','plan','results','previous'].includes(k))||!Array.isArray(input.results)||input.results.length>128){add('input_invalid');return report;}
 report.input_digest=hash(input);
 const {profile,executionProfile,context,catalog,plan,results,previous}=input;
 const current=planSecurityChecks({profile,executionProfile,context,catalog});
 if(current.status!=='pass'){report.diagnostics=current.diagnostics;report.decision=current.inputs?'needs_work':'invalid';report.checks=current.checks.filter(c=>c.status!=='not_applicable').map(c=>({check_id:c.check_id,status:'not_evaluated',finding_count:0}));return report;}
 if(!validate('plan',plan).valid||plan.status!=='pass'||!same(planSecurityChecks(plan.inputs),plan)||!same(plan.inputs.profile,profile)||!same(plan.inputs.executionProfile,executionProfile)||!same(plan.inputs.catalog,catalog)||!same(snapshots(plan.inputs.context),snapshots(context))){add('binding_mismatch');return report;}
 if(!finiteTimes(input)||results.length+(previous?.results?.length??0)>128||results.reduce((n,r)=>n+(r.findings?.length??0),0)+(previous?.results??[]).reduce((n,r)=>n+(r.findings?.length??0),0)>1000||results.some(r=>!validate('result',r).valid)||previous&&(!Array.isArray(previous.results)||Object.keys(previous).some(k=>k!=='results')||previous.results.some(r=>!validate('result',r).valid))){add('schema_invalid');return report;}
 report.decision='needs_work';const byCheck=new Map();
 const operations=new Set();
 for(const [index,r]of results.entries()){
  const check=plan.checks.find(x=>x.check_id===r.check_id),definition=profile.checks.find(x=>x.check_id===r.check_id);
  if(operations.has(r.receipt.operation_id))add('evidence_invalid',index);operations.add(r.receipt.operation_id);
  if(!check||!definition||r.input_digest!==r.verification.input_digest||r.verification.check_id!==r.check_id||r.verification.command_id!==definition.command_id||!same(r.verification.argv_redacted,scannerArgv(r.tool_id,check.targets))||!same(r.verification.scope,check.targets)||r.verification.domain!==(profile.domain==='app'?'app':'template')||r.rules_digest!==hash(catalog.rules)||r.receipt.version!==r.tool_version||r.receipt.started_at!==r.started_at||r.receipt.finished_at!==r.finished_at||r.status==='passed'&&(!r.receipt.completed||!r.receipt.stopped||r.receipt.timed_out||r.receipt.output_limited||r.receipt.exit_code!==0||!r.receipt.target_count||r.findings.length))add('evidence_invalid',index);
  if(r.intelligence.kind!==(r.tool_id==='osv'?'vulnerability_snapshot':'rules')||!same(r.intelligence.snapshots,r.tool_id==='osv'?plan.inputs.context.inventory.databases.filter(d=>check?.formats.includes(d.ecosystem)):[]))add('evidence_invalid',index);
  if(previous?.results.some(old=>old.receipt.operation_id===r.receipt.operation_id&&!same(old,r)))add('evidence_invalid',index);
  if(!same(r.subject,context.subject)||r.plan_digest!==hash(plan)||r.profile_digest!==hash(profile)||r.catalog_digest!==hash(catalog)||r.tool_id!==plan.checks.find(c=>c.check_id===r.check_id)?.tool_id||!same(r.verification.subject,r.subject)||r.verification.status!==r.status||r.receipt.exit_code!==r.verification.exit_code||r.tool_version!==catalog.tools.find(t=>t.tool_id===r.tool_id)?.version||!fresh(r.finished_at,context.evaluated_at,profile.max_age_seconds)||Date.parse(r.started_at)>Date.parse(r.finished_at))add('evidence_invalid',index);
  if(!byCheck.has(r.check_id))byCheck.set(r.check_id,[]);byCheck.get(r.check_id).push(r);
 }
 for(const [index,check]of plan.checks.entries()){
  if(check.status==='not_applicable')continue;
  const rows=byCheck.get(check.check_id)??[];rows.sort((a,b)=>Date.parse(b.finished_at)-Date.parse(a.finished_at));const r=rows[0];
  if(!r){if(check.required)add('evidence_missing',index);report.checks.push({check_id:check.check_id,status:'not_evaluated',finding_count:0});continue;}
  if(rows.length>1&&rows[0].finished_at===rows[1].finished_at)add('evidence_invalid',index);
  report.checks.push({check_id:check.check_id,status:r.status,finding_count:r.findings.length});
  let excepted=0;
  for(const f of r.findings){const e=profile.exceptions.find(e=>e.finding_id===f.finding_id);if(e){if(e.head_sha===context.subject.head_sha&&e.actor.actor_type==='human'&&[profile.human_owner,...executionProfile.delegates].includes(e.actor.actor_ref)&&e.reason.trim()&&Date.parse(e.issued_at)<=Date.parse(context.evaluated_at)&&Date.parse(e.expires_at)>Date.parse(context.evaluated_at)){add('human_exception',index);excepted++;}else add('exception_invalid',index);}else add('finding_open',index);}
  if(r.status!=='passed'&&!(r.status==='failed'&&r.findings.length>0&&excepted===r.findings.length))add('evidence_invalid',index);
 }
 const historical=[...(previous?.results??[]),...results.filter(r=>byCheck.get(r.check_id)?.[0]!==r)];
 for(const old of historical){if(old.subject.issue_number!==context.subject.issue_number||old.subject.run_id!==context.subject.run_id){add('binding_mismatch');continue;}for(const f of old.findings)if(![...byCheck.values()].map(rows=>rows[0]).some(r=>r.findings.some(v=>v.finding_id===f.finding_id))){
  const recheck=context.rechecks?.find(r=>r.execution_status==='completed'&&r.status==='passed'&&same(r.subject,context.subject)&&r.implementer.context_id!==r.reviewer.context_id&&r.reviewer.actor.actor_type==='ai_agent'&&r.rechecks?.some(x=>x.finding_id===f.finding_id&&x.finding_digest===hash(f))&&results.some(v=>v.status==='passed'&&r.verification_refs.some(ref=>ref.kind==='verification'&&ref.id===v.verification.artifact_id&&ref.revision===v.verification.revision&&ref.digest===hash(v.verification))&&Date.parse(r.started_at)>=Date.parse(v.finished_at)));
  if(!recheck||!validateExecutionArtifact('review',recheck).valid||!fresh(recheck.finished_at,context.evaluated_at,profile.max_age_seconds))add('recheck_required');
 }}
 report.diagnostics=maxDiagnostics(report.diagnostics);
 report.status=report.diagnostics.length?'blocked':'pass';report.decision=report.status==='pass'?'evidence_complete':report.diagnostics.every(d=>d.code==='human_exception')?'human_review':'needs_work';return report;
}
