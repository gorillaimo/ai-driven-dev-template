import { fixture as workflow, finish, event, approval, ref, stamp } from '../../workflow-check/fixtures/build.mjs';
import { digest, canonical } from '../../../tools/workflow-rules/resolve.mjs';
export { ref, stamp };
export const boundaries=['draft','requirements_to_design','design_to_implementation','implementation_to_pr','completion'];
export function fixture(boundary='implementation_to_pr',risk='medium',feature=true){
 const w=workflow(risk,feature);const selected=id=>w.plan.stages.find(s=>s.stage_id===id)?.selection!=='skipped';
 if(boundary!=='draft'){
  for(const id of ['intake','context','requirements']) if(selected(id)) finish(w,id);
  for(const s of w.plan.stages.filter(s=>s.selection==='skipped')) event(w,'stage_skipped',s.stage_id);
  if(boundary!=='requirements_to_design'){
   for(const id of ['design','api','quality']) if(selected(id)) finish(w,id);
   if(risk==='high'){approval(w,'design','design');approval(w,'quality','quality');}
  }
  if(['implementation_to_pr','completion'].includes(boundary)){
   for(const id of ['tests','implementation','validation']) if(selected(id)) finish(w,id);
   w.state.validations.push({validation_id:'run-1',status:'passed',reference:{kind:'file',target:'tests/report.json'},executed_at:stamp});
   w.state.extensions.workflow_check.validation_scopes.push({validation_id:'run-1',plan_revision:1,stage:'validation'});
  }
  w.state.next_stage=boundary==='requirements_to_design'?(selected('design')?'design':'validation'):boundary==='design_to_implementation'?(selected('tests')?'tests':'validation'):'handoff';
  if(boundary==='completion'){finish(w,'handoff');event(w,'work_completed');w.state.next_stage=null;}
  w.previous={plan:structuredClone(w.plan),state:structuredClone(w.state)};
 }
 const node=(id,kind,path,status='complete')=>({id,kind,ref:{kind:'file',target:path},status});
 const nodes=[{id:'ac-1',kind:'acceptance_criterion',ref,status:'complete'}, {id:'excluded-1',kind:'non_scope',ref:{...ref,fragment:'non-scope'},status:'complete'}];
 const links=[];
 if(selected('requirements')){nodes.push(node('req-1','requirement','docs/requirements.md'));links.push({from:'req-1',to:'ac-1',relation:'satisfies'});}
 if(selected('design')){nodes.push(node('design-1','design','docs/design.md',boundary==='requirements_to_design'?'pending':'complete'));links.push({from:'design-1',to:'req-1',relation:'implements'});}
 if(selected('api')){nodes.push(node('api-1','api','docs/api.yaml'));links.push({from:'api-1',to:'design-1',relation:'implements'});}
 if(selected('tests')){nodes.push(node('test-1','test','tests/example.test.mjs'));links.push({from:'test-1',to:'ac-1',relation:'verifies'});}
 nodes.push(node('change-1','change','src/example.mjs'),node('validation-1','validation','tests/report.json'));
 links.push({from:'change-1',to:selected('design')?'design-1':'ac-1',relation:'implements'},{from:'validation-1',to:'change-1',relation:'verifies'});
 if(selected('tests')) links.push({from:'validation-1',to:'test-1',relation:'verifies'});
 if(selected('quality')){
  nodes.push(node('gate-quality','quality_gate','docs/quality.md'));links.push({from:'gate-quality',to:'ac-1',relation:'references'});
 }
 for(const [index,a] of w.state.approvals.entries()){
  nodes.push({id:'approval-'+index,kind:'approval',ref:a.reference,status:'complete'});
  links.push({from:'approval-'+index,to:a.approval_type==='quality'?'gate-quality':'design-1',relation:'references'});
 }
 const traceability={schema_version:1,artifact_kind:'traceability',work_id:w.plan.work_id,work_source:w.plan.work_source,issue_ref:w.plan.issue_ref,updated_at:stamp,updated_by:w.plan.updated_by,nodes,links,checks:[],suppressions:[]};
 const context={schema_version:1,work_id:w.plan.work_id,work_source:w.plan.work_source,issue_ref:w.plan.issue_ref,plan_revision:1,contract_ref:ref,boundary,evaluated_at:stamp,
  criteria:[{id:'ac-1',ref,required_kinds:[],exemptions:[]}],non_scope:[{id:'excluded-1',ref:{...ref,fragment:'non-scope'}}],
  change_inventory:[{node_id:'change-1',path:'src/example.mjs',operation:'modified'}],external_confirmations:[],suppression_scopes:[]};
 const references=[];
 for(const n of nodes) if(!references.some(r=>canonical(r.reference)===canonical(n.ref))){
  const status=n.ref.kind==='url'?'human_asserted':'local_verified';references.push({reference:n.ref,status,digest:status==='local_verified'?digest('synthetic'):null});
  if(status==='human_asserted') context.external_confirmations.push({reference:n.ref,confirmed_by:'example-user',confirmed_at:stamp,evidence:[ref]});
 }
 return {traceability,workflowInput:w,context,references};
}
