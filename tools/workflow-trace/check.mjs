import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { canonical,digest,compare } from 'workflow-rules/resolve';
import { checkWorkflow } from 'workflow-check/check';
import { inspectGraph } from './graph.mjs';
import { inspectCoverage } from './coverage.mjs';
import { checkReferences } from './references.mjs';
import { applySuppressions,subjectDigest } from './suppressions.mjs';
import { messages } from './messages.mjs';
const root=new URL('../../',import.meta.url),ajv=new Ajv({strict:true,allErrors:true});addFormats(ajv);
for(const name of ['common','traceability']) ajv.addSchema(JSON.parse(readFileSync(new URL('.ai-workflow/schemas/issue/v1/'+name+'.schema.json',root),'utf8')));
for(const name of ['suppression-scope','context','result']) ajv.addSchema(JSON.parse(readFileSync(new URL('.ai-workflow/schemas/trace-checks/v1/'+name+'.schema.json',root),'utf8')));
export function validateArtifact(kind,value){return !!ajv.getSchema(kind==='traceability'?'urn:ai-workflow:issue:v1:traceability':'urn:ai-workflow:trace-checks:v1:'+kind)?.(value);}
const refValidator=ajv.getSchema('urn:ai-workflow:trace-checks:v1:result#/$defs/referenceResult');

export function checkTraceability(input={}){
 input=input??{};const findings=[],{context:c,traceability:t}=input;
 const boundary=['draft','requirements_to_design','design_to_implementation','implementation_to_pr','completion'].includes(c?.boundary)?c.boundary:'draft';
 const add=(code,path='',node=null,edge=null,protectedFinding=false)=>{
  if(!messages[code]) throw new Error('Unknown diagnostic');
  const identity={code,path,node,edge,boundary};
  findings.push({check_id:'check-'+digest(canonical(identity)).slice(0,24),code,path,node,edge,severity:protectedFinding||boundary!=='draft'?'block':'warn',suppressed:false,protected:protectedFinding});
 };
 let coverage=[],referenceResults=[],subject=digest(canonical(input));
 if(!validateArtifact('context',c)||!validateArtifact('traceability',t)||!Array.isArray(input.references)||!input.references.every(r=>refValidator(r))) add('schema_invalid','input',null,null,true);
 else{
  subject=subjectDigest(input);
  let workflow;
  try{workflow=checkWorkflow(input.workflowInput);}catch{add('workflow_invalid','workflowInput',null,null,true);}
  if(workflow){
   for(const id of ['schema','identity','rules','plan','state']) if(workflow.checks.find(c=>c.check_id===id)?.status!=='pass') add('workflow_invalid','workflowInput/'+id,null,null,true);
   if(boundary!=='draft'&&workflow.checks.find(c=>c.check_id==='append_only')?.status!=='pass') add('workflow_invalid','workflowInput/previous',null,null,true);
   if(workflow.diagnostics.some(d=>['intake_blocked','git_changed','issue_changed','unsafe_retry'].includes(d.code))) add('workflow_invalid','workflowInput/safety',null,null,true);
  }
  const w=input.workflowInput;
  if(!workflow||!w?.plan||!w?.state||!w?.context||findings.some(f=>f.code==='workflow_invalid')){
   // A malformed workflow is never used to manufacture graph evidence.
  }else{
   for(const key of ['work_id','work_source','issue_ref','project_id','feature_id']) if(t[key]!==c[key]||t[key]!==w.plan[key]) add('identity_mismatch',key,null,null,true);
   if(c.plan_revision!==w.plan.revision||canonical(c.contract_ref)!==canonical(w.context.contract_ref)) add('identity_mismatch','context/contract',null,null,true);
   if([t.updated_at,w.plan.updated_at,w.state.updated_at].some(time=>Date.parse(time)>Date.parse(c.evaluated_at))) add('identity_mismatch','context/evaluated_at',null,null,true);
   const graph=inspectGraph(t,add);
   const result=inspectCoverage(input,graph,add);coverage=result.coverage;
   referenceResults=checkReferences(input,graph,result.needed,add);
  }
  const unique=[...new Map(findings.map(f=>[f.check_id,f])).values()];findings.splice(0,findings.length,...unique);
  applySuppressions(input,findings,subject,add);
 }
 const diagnostics=[...new Map(findings.map(f=>[f.check_id,f])).values()].sort((a,b)=>compare(a.check_id,b.check_id));
 const status=diagnostics.some(d=>d.severity==='block'&&!d.suppressed)?'blocked':diagnostics.length?'warn':'pass';
 const publicDiagnostics=diagnostics.map(({protected:ignored,...value})=>value);
 const checks=publicDiagnostics.length?publicDiagnostics.map(d=>({check_id:d.check_id,boundary,result:d.suppressed?'warn':d.severity,references:d.node?[{kind:'id',target:d.node}]:[],reason:d.code+(d.suppressed?': suppressed':'')})):
  [{check_id:'traceability-pass',boundary,result:'pass',references:[],reason:messages.trace_pass}];
 const output={schema_version:1,checker_version:'1.0.0',input_digest:digest(canonical(input)),subject_digest:subject,boundary,status,coverage,diagnostics:publicDiagnostics,references:referenceResults,checks};
 if(!validateArtifact('result',output)) throw new Error('Invalid trace result');
 return output;
}
