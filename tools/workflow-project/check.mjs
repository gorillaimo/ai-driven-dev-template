import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { canonical, digest, compare } from 'workflow-rules/resolve';
import { inspectJson, countLimit, MAX_RESULT } from './limits.mjs';
import { inspectGraph, attachConflicts } from './graph.mjs';
import { inspectFacts, planWaves } from './waves.mjs';
import { inspectHistory, inspectRevision } from './revision.mjs';
import { messages } from './messages.mjs';

const root=new URL('../../',import.meta.url),ajv=new Ajv({strict:true,allErrors:true});addFormats(ajv);
for(const [dir,kinds] of [['issue',['common']],['project',['common','project','delivery-plan']],['project-plan-checks',['context','result']]]) {
  for(const kind of kinds)ajv.addSchema(JSON.parse(readFileSync(new URL('.ai-workflow/schemas/'+dir+'/v1/'+kind+'.schema.json',root),'utf8')));
}
const urns={project:'urn:ai-workflow:project:v1:project',deliveryPlan:'urn:ai-workflow:project:v1:delivery-plan',context:'urn:ai-workflow:project-plan-checks:v1:context',result:'urn:ai-workflow:project-plan-checks:v1:result'};
export function validateArtifact(kind,value) {
  const validator=ajv.getSchema(urns[kind]);if(!validator)throw Error('unknown_artifact');
  // No property names, custom messages or offending values escape Ajv.
  const valid=!!validator(value);return {valid};
}
const emptySchedule=()=>({waves:[],dependency_candidates:[],waiting:[],active:[],completed:[],cancelled:[],serialization:[]});
const emptyImpact=()=>({changed_feature_ids:[],affected_feature_ids:[],invalidated_waves:[],active_decisions:[]});

export function checkProjectPlan(input) {
  const diagnostics=[],checks=[];let capped=null,diagnosticBytes=0;
  const add=(code,path='',feature_id=null,related=[])=>{
    if(!messages[code])throw Error('unknown_diagnostic');
    if(capped)return;
    if(diagnostics.length>=999){capped='diagnostic_limit';return;}
    const diagnostic={code,path,feature_id,related};
    diagnosticBytes+=Buffer.byteLength(canonical(diagnostic));
    if(diagnosticBytes>MAX_RESULT/2){capped='output_limit';return;}
    diagnostics.push(diagnostic);
  };
  const check=(check_id,fn)=>{const before=diagnostics.length;fn();checks.push({check_id,status:diagnostics.length===before&&!capped?'pass':'block'});};
  let usable=false, schemaOK=false,project_digest=null,plan_digest=null,input_digest=null,observed_at=null;
  let schedule=emptySchedule(),impact=emptyImpact();
  check('input',()=>{
    const error=inspectJson(input);
    if(error){add(error);return;}
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['project','deliveryPlan','context','previous'].includes(k))) {add('input_invalid');return;}
    if(countLimit(input)||(input.previous&&countLimit(input.previous))){add('input_limit');return;}
    input_digest=digest(canonical(input));usable=true;
  });
  if(usable)check('schema',()=>{
    const sets=[['',input]];if(input.previous!==undefined)sets.push(['previous/',input.previous]);
    for(const [prefix,set] of sets) {
      if(!set||typeof set!=='object'||Array.isArray(set)||Object.keys(set).some(k=>!['project','deliveryPlan','context',...(prefix?[]:['previous'])].includes(k))){add('schema_invalid',prefix);continue;}
      for(const kind of ['project','deliveryPlan','context'])if(!validateArtifact(kind,set[kind]).valid)add('schema_invalid',prefix+kind);
    }
    schemaOK=!diagnostics.length;
  });
  if(schemaOK) {
    project_digest=digest(canonical(input.project));plan_digest=digest(canonical(input.deliveryPlan));observed_at=input.context.observed_at;
    const identity=(s,prefix)=>{
      const {project:p,deliveryPlan:d,context:c}=s;
      if(p.project_id!==d.project_id)add('identity_mismatch',prefix+'deliveryPlan/project_id');
      if(c.project_id!==p.project_id||c.project_revision!==p.revision||c.plan_revision!==d.revision||c.project_digest!==digest(canonical(p))||c.plan_digest!==digest(canonical(d)))add('context_mismatch',prefix+'context');
    };
    check('identity',()=>{identity(input,'');if(input.previous)identity(input.previous,'previous/');});
    let graph,oldGraph,records,oldRecords;
    check('dag',()=>{graph=inspectGraph(input.project,input.deliveryPlan,add);if(input.previous)oldGraph=inspectGraph(input.previous.project,input.previous.deliveryPlan,add,'previous/');});
    check('facts',()=>{
      records=inspectFacts(input,graph,add,'',input.previous?.deliveryPlan.features.map(f=>f.feature_id)??[]);
      if(input.previous)oldRecords=inspectFacts(input.previous,oldGraph,add,'previous/',input.previous.deliveryPlan.revision_history.flatMap(r=>r.affected_feature_ids));
    });
    check('history',()=>{inspectHistory(input.deliveryPlan,add);if(input.previous)inspectHistory(input.previous.deliveryPlan,add,'previous/');});
    if(!diagnostics.length&&!capped) {
      attachConflicts(graph);if(oldGraph)attachConflicts(oldGraph);
      const oldSchedule=oldGraph?planWaves(oldGraph,oldRecords):emptySchedule();
      check('revision',()=>{impact=inspectRevision(input,input.previous,graph,oldGraph,records,oldRecords,oldSchedule,add);});
      if(!diagnostics.length&&!capped)check('waves',()=>{schedule=planWaves(graph,records);});
    }
  }
  if(capped)diagnostics.push({code:capped,path:'',feature_id:null,related:[]});
  const not_evaluated=['membership_permission_capacity','reference_existence','approval_authenticity','snapshot_freshness','feature_completion_aggregation','full_history_provenance','disjoint_scope_proof'];
  if(schemaOK&&!input.deliveryPlan.features.length)not_evaluated.push('empty_plan');
  const result={schema_version:1,checker_version:'1.0.0',input_digest,
    project_id:schemaOK?input.project.project_id:null,project_revision:schemaOK?input.project.revision:null,plan_revision:schemaOK?input.deliveryPlan.revision:null,
    project_digest,plan_digest,observed_at,status:diagnostics.length?'blocked':'pass',checks,
    diagnostics:[...new Map(diagnostics.map(d=>[canonical(d),d])).values()].sort((a,b)=>compare(canonical(a),canonical(b))),
    ...(diagnostics.length?emptySchedule():schedule),revision_impact:impact,not_evaluated:not_evaluated.sort(compare)};
  if(Buffer.byteLength(canonical(result))>MAX_RESULT){
    Object.assign(result,emptySchedule(),{status:'blocked',revision_impact:emptyImpact(),diagnostics:[{code:'output_limit',path:'',feature_id:null,related:[]} ]});
    result.checks.push({check_id:'output',status:'block'});
  }
  if(!validateArtifact('result',result).valid)throw Error('invalid_checker_result');
  return result;
}
