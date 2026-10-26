import { canonical } from 'workflow-rules/resolve';
const same=(a,b)=>canonical(a)===canonical(b);
const stageFor={requirement:'requirements',design:'design',api:'api',test:'tests',change:'implementation',validation:'validation'};
export function inspectCoverage(input,graph,add){
 const {traceability:t,workflowInput:w,context:c}=input,{nodes,outgoing,ancestors}=graph;
 const selected=id=>w.plan.stages.some(s=>s.stage_id===id&&s.selection!=='skipped');
 const late=['implementation_to_pr','completion'].includes(c.boundary),designBoundary=c.boundary!=='draft'&&c.boundary!=='requirements_to_design';
 const needed=new Set(),coverage=[];
 for(const [entries,kind] of [[c.criteria,'acceptance_criterion'],[c.non_scope,'non_scope']]){
  const seen=new Set();
  for(const entry of entries){
   if(seen.has(entry.id)) add('inventory_mismatch','context/inventory',entry.id,null,true);
   seen.add(entry.id);const n=nodes.get(entry.id);
   if(!n||n.kind!==kind||!same(n.ref,entry.ref)) add('inventory_mismatch','context/inventory',entry.id,null,true);
   if(n){needed.add(n.id);if(n.status!=='complete'&&c.boundary==='completion') add('node_incomplete','traceability/nodes',n.id,null,true);}
  }
  for(const n of nodes.values()) if(n.kind===kind&&!seen.has(n.id)) add('inventory_mismatch','traceability/nodes',n.id,null,true);
 }
 const changes=new Map(),paths=new Set();
 for(const entry of c.change_inventory){
  if(changes.has(entry.node_id)||paths.has(entry.path)) add('inventory_mismatch','context/change_inventory',entry.node_id,null,true);
  changes.set(entry.node_id,entry);paths.add(entry.path);
  const n=nodes.get(entry.node_id);
  if(!n||n.kind!=='change'||n.ref.kind!=='file'||n.ref.target!==entry.path) add('inventory_mismatch','context/change_inventory',entry.node_id,null,true);
 }
 for(const n of nodes.values()) if(n.kind==='change'&&!changes.has(n.id)) add('inventory_mismatch','traceability/nodes',n.id,null,true);
 for(const criterion of c.criteria){
  const required=new Set(criterion.required_kinds);
  for(const kind of ['requirement','design']) if(selected(stageFor[kind])) required.add(kind);
  if(designBoundary&&selected('api')) required.add('api');
  if(late){if(selected('tests')) required.add('test');if(selected('implementation')||changes.size) required.add('change');required.add('validation');}
  for(const exemption of criterion.exemptions){
   if(selected(stageFor[exemption.kind])||exemption.confirmation.approval_type!=='not-applicable'||Date.parse(exemption.confirmation.approved_at)>Date.parse(c.evaluated_at)) add('inventory_mismatch','context/criteria',criterion.id,null,true);
   // Exemptions never remove a required selected kind.
  }
  const matches={};
  for(const kind of required){
   matches[kind]=[...nodes.values()].filter(n=>n.kind===kind&&n.status!=='not_applicable'&&ancestors(n.id).has(criterion.id)).map(n=>n.id).sort();
   if(!matches[kind].length) add('coverage_missing','coverage/'+kind,criterion.id);
   for(const id of matches[kind]){
    const n=nodes.get(id),future=c.boundary==='draft'||(c.boundary==='requirements_to_design'&&kind==='design');
    if(!future&&n.status!=='complete') add('node_incomplete','traceability/nodes',id);
    if(!future||n.status==='complete') needed.add(id);
   }
  }
  coverage.push({ac_id:criterion.id,required_kinds:[...required].sort(),matches,complete:[...required].every(kind=>matches[kind].length&&matches[kind].every(id=>nodes.get(id).status==='complete'))});
 }
 // An implementation cannot shortcut an intermediate stage which the plan adopted.
 for(const n of nodes.values()) if(n.kind==='change'&&n.status!=='not_applicable'){
  const targetKind=selected('design')?'design':selected('requirements')?'requirement':'acceptance_criterion';
  if(!outgoing.get(n.id).some(e=>e.relation==='implements'&&nodes.get(e.to)?.kind===targetKind)) add('coverage_missing','coverage/change',n.id);
 }
 if(designBoundary&&selected('quality')){
  const gates=[...nodes.values()].filter(n=>n.kind==='quality_gate'&&n.status==='complete');
  if(!gates.length) add('node_incomplete','coverage/quality_gate');
  for(const n of gates) needed.add(n.id);
  for(const gate of Object.values(w.context.gates).filter(g=>g.applicable)) if(!gates.some(n=>gate.evidence.some(ref=>same(ref,n.ref)))) add('node_incomplete','coverage/quality_gate');
 }
 // A typed artifact must connect to the authoritative AC inventory, not merely an arbitrary node.
 for(const n of nodes.values()) if(['requirement','design','api','test','change','validation'].includes(n.kind)&&n.status!=='not_applicable'&&![...ancestors(n.id)].some(id=>c.criteria.some(ac=>ac.id===id))) add('orphan_node','traceability/nodes',n.id);
 if(late) for(const n of nodes.values()) if(['test','change'].includes(n.kind)&&n.status!=='not_applicable'){
  if(!graph.incoming.get(n.id).some(e=>e.relation==='verifies'&&nodes.get(e.from)?.kind==='validation'&&nodes.get(e.from).status==='complete')) add('coverage_missing','coverage/validation',n.id);
 }
 const extension=w.state.extensions.workflow_check;
 if(designBoundary){
  const requirements=[];
  if(w.plan.risk==='high') requirements.push(['design','design'],['quality','quality']);
  for(const s of w.plan.stages) if(s.approval_required||w.context.approval_stages.includes(s.stage_id)) requirements.push([s.stage_id,'stage']);
  if(['design_to_implementation','implementation_to_pr','completion'].includes(c.boundary)){
   const target=c.boundary==='design_to_implementation'?(selected('tests')?'tests':'implementation'):'implementation';
   for(const rule of w.ruleInput.rules) if(rule.approval_required&&w.plan.resolved_rules.some(r=>r.rule_id===rule.rule_id)) requirements.push([target,'rule',rule.rule_id]);
  }
  for(const [stage,type,ruleId] of requirements){
   const scopes=extension.approval_scopes.filter(s=>s.stage===stage&&s.rule_id===ruleId&&s.plan_revision===w.plan.revision&&same(s.contract_ref,c.contract_ref));
   if(!scopes.some(scope=>w.state.approvals.some(a=>a.approval_type===type&&same(a.reference,scope.reference))&&[...nodes.values()].some(n=>n.kind==='approval'&&n.status==='complete'&&same(n.ref,scope.reference)))) add('approval_invalid','coverage/approval',null,null,true);
  }
 }
 for(const n of nodes.values()){
  if(n.kind==='approval'&&n.status==='complete'&&designBoundary){
   const scope=extension.approval_scopes.find(s=>s.plan_revision===w.plan.revision&&same(s.reference,n.ref)&&same(s.contract_ref,c.contract_ref));
   const targetKind={design:'design',quality:'quality_gate',tests:'test',implementation:'change',requirements:'requirement',api:'api',validation:'validation'}[scope?.stage];
   const scopeLinked=targetKind&&outgoing.get(n.id).some(e=>e.relation==='references'&&nodes.get(e.to)?.kind===targetKind);
   if(!scope||!scopeLinked||!w.state.approvals.some(a=>same(a.reference,n.ref))) add('approval_invalid','traceability/nodes',n.id,null,true);
   needed.add(n.id);
  }
  if(n.kind==='validation'&&n.status==='complete'&&late){
   const candidates=w.state.validations.map((value,index)=>({value,index})).filter(({value:v})=>same(v.reference,n.ref)&&extension.validation_scopes.some(s=>s.validation_id===v.validation_id&&s.plan_revision===w.plan.revision&&s.stage==='validation'));
   candidates.sort((a,b)=>(a.value.executed_at?Date.parse(a.value.executed_at):Infinity)-(b.value.executed_at?Date.parse(b.value.executed_at):Infinity)||a.index-b.index);
   const latest=candidates.at(-1)?.value;
   const valid=latest?.status==='passed'&&latest.executed_at&&Date.parse(latest.executed_at)<=Date.parse(c.evaluated_at);
   if(!valid) add('validation_invalid','traceability/nodes',n.id,null,true);
   needed.add(n.id);
  }
  if(c.boundary==='completion'&&['open_question','remaining_work'].includes(n.kind)&&n.status==='pending'){
   const handedOff=outgoing.get(n.id).some(e=>e.relation==='follows_up'&&nodes.get(e.to)?.kind==='follow_up'&&nodes.get(e.to).status==='complete');
   if(!handedOff) add('follow_up_missing','traceability/nodes',n.id);
   else for(const e of outgoing.get(n.id).filter(e=>e.relation==='follows_up')) needed.add(e.to);
  }
 }
 if(c.boundary==='completion'){
  for(const s of w.plan.stages) if(!['completed','skipped'].includes(w.state.stages.find(x=>x.stage_id===s.stage_id)?.status)) add('stage_incomplete','workflowInput/state',null,null,true);
 }
 if(c.boundary!=='draft'){
  const before={requirements_to_design:['requirements'],design_to_implementation:['requirements','design','api','quality'],implementation_to_pr:['requirements','design','api','quality','tests','implementation','validation'],completion:[]}[c.boundary];
  for(const id of before) if(selected(id)&&w.state.stages.find(s=>s.stage_id===id)?.status!=='completed') add('stage_incomplete','workflowInput/state',null,null,true);
 }
 if(c.feature_id){
  const feature=nodes.get(c.feature_id);
  if(!feature||feature.kind!=='feature'||!outgoing.get(feature.id).some(e=>e.relation==='references'&&c.criteria.some(a=>a.id===e.to))) add('inventory_mismatch','context/feature_id',c.feature_id,null,true);
  else needed.add(feature.id);
 }
 // Excluded nodes are explanatory, never evidence; other NA nodes need a matching approved omission.
 for(const n of nodes.values()) if(n.status==='not_applicable'){
  const excluded=graph.incoming.get(n.id).some(e=>e.relation==='excludes'&&nodes.get(e.from)?.kind==='non_scope');
  const justified=!selected(stageFor[n.kind])&&c.criteria.some(ac=>ac.exemptions.some(e=>e.kind===n.kind));
  if(!excluded&&!justified) add('node_incomplete','traceability/nodes',n.id);
 }
 return {needed,coverage:coverage.sort((a,b)=>a.ac_id<b.ac_id?-1:a.ac_id>b.ac_id?1:0)};
}
