import{validateSecurityArtifact}from'./schema.mjs';
import{validateExecutionArtifact}from'workflow-execution/schema';import{inspectJson}from'./limits.mjs';import{hash,matches,within,fresh}from'./core.mjs';
// The caller supplies an already-approved application CI environment. No host executor is implicit.
export async function runApplicationVerification(input,executor){
 const missing={status:'not_evaluated',code:'application_execution_unavailable'};
 if(inspectJson(input)||!input||Object.keys(input).some(k=>!['executionProfile','subject','checkId','commandId','workspace','scope','observed_at','recorded_by'].includes(k))||!executor?.executeApplication)return missing;
 const {executionProfile:p,subject,checkId,commandId,workspace,scope,observed_at,recorded_by}=input;
 if(!validateExecutionArtifact('profile',p).valid||!validateSecurityArtifact('subject',subject).valid||!validateSecurityArtifact('actor',recorded_by).valid||!matches(subject.profile,p)||!Array.isArray(scope)||!scope.length||scope.some(path=>typeof path!=='string'||!/^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path)||!within(path,p.allowed_paths)||within(path,p.forbidden_paths)))return missing;
 const check=p.checks.find(c=>c.kind==='verification'&&c.check_id===checkId&&c.command_id===commandId),command=p.commands.find(c=>c.command_id===commandId);if(!check||!command)return missing;
 try{
  const receipt=await executor.executeApplication({executable:command.executable,argv:[...command.argv],workspace,shell:false,timeout_seconds:p.limits.call_seconds});
  const completedAt=executor.now?.()??new Date().toISOString();
  if(!Number.isFinite(Date.parse(completedAt))||Date.parse(observed_at)>Date.parse(completedAt)||inspectJson(receipt)||!receipt||!fresh(receipt.finished_at,completedAt,p.max_age_seconds)||Date.parse(receipt.started_at)>Date.parse(receipt.finished_at)||!Number.isFinite(Date.parse(receipt.started_at)))return missing;
  const status=!receipt.completed||!receipt.stopped?'error':receipt.exit_code!==0||check.test_check&&(!Number.isSafeInteger(receipt.test_count)||receipt.test_count<check.min_tests)?'failed':'passed';
  const record={schema_version:1,artifact_kind:'verification',artifact_id:'app-'+hash({subject,commandId,receipt}).slice(0,32),revision:1,repository:p.repository,recorded_at:completedAt,recorded_by,input_digest:hash({subject,command,receipt}),evidence_refs:receipt.log_refs,subject:structuredClone(subject),check_id:checkId,domain:check.domain,acs:[...check.acs],command_id:commandId,argv_redacted:[...command.argv],environment:'caller-approved-application-ci',tool_version:receipt.tool_version,started_at:receipt.started_at,finished_at:receipt.finished_at,status,exit_code:receipt.exit_code,test_count:check.test_check?receipt.test_count:null,scope:[...scope],log_refs:receipt.log_refs};
  return validateExecutionArtifact('verification',record).valid?record:missing;
 }catch{return {status:'error',code:'application_execution_failed'};}
}
