import { readLocal, parseYaml } from 'workflow-rules/load';
import { digest, canonical, compare } from 'workflow-rules/resolve';

export function inspectReference(root, reference, deleted = false) {
 if(reference.kind!=='file') return {reference,status:'not_evaluated',digest:null};
 let text;
 try {text=readLocal(root,reference.target);} catch(error){
  if(error.code==='ENOENT') return {reference,status:deleted?'deleted_declared':'missing',digest:null};
  throw error;
 }
 if(deleted) return {reference,status:'not_evaluated',digest:digest(text)};
 let status='local_verified';
 if(reference.fragment){
  const fragment=reference.fragment;
  if(/\.(json|ya?ml)$/i.test(reference.target)&&fragment.startsWith('/')){
   const value=parseYaml(text);let current=value,exists=true;
   for(const token of fragment.slice(1).split('/')){
    if(/~(?![01])/u.test(token)){exists=false;break;}
    const key=token.replace(/~1/g,'/').replace(/~0/g,'~');
    if(current===null||typeof current!=='object'||!Object.hasOwn(current,key)){exists=false;break;}
    current=current[key];
   }
   status=exists?'local_verified':'missing';
  }else if(/\.md$/i.test(reference.target)) status=text.includes('{#'+fragment+'}')?'local_verified':'not_evaluated';
  else status='not_evaluated';
 }
 return {reference,status,digest:digest(text)};
}

export function collectReferences(root,input) {
 const records=new Map(),{traceability,context,workflowInput}=input;
 const refs=[...traceability.nodes.map(n=>n.ref),...workflowInput.plan.stages.flatMap(s=>s.artifacts)];
 for(const reference of refs){
  if(records.has(canonical(reference))) continue;
  let result;
  if(reference.kind==='file'){
   const deleted=context.change_inventory.some(c=>c.operation==='deleted'&&c.path===reference.target);
   result=inspectReference(root,reference,deleted);
  }else if(reference.kind==='id'){
   const target=traceability.nodes.find(n=>n.id===reference.target);
   result={reference,status:target?'local_verified':'missing',digest:target?digest(canonical(target)):null};
  }else{
   const confirmed=context.external_confirmations.some(c=>canonical(c.reference)===canonical(reference)&&Date.parse(c.confirmed_at)<=Date.parse(context.evaluated_at));
   result={reference,status:confirmed?'human_asserted':'not_evaluated',digest:null};
  }
  records.set(canonical(reference),result);
 }
 return [...records.values()].sort((a,b)=>compare(canonical(a.reference),canonical(b.reference)));
}

export function checkReferences(input, graph, needed, add) {
 const {context,references,workflowInput}=input,byRef=new Map();
 for(const r of references){
  const key=canonical(r.reference);
  if(byRef.has(key)) add('reference_invalid','references',null,null,true);
  byRef.set(key,r);
  if(r.status==='local_verified'&&(r.reference.kind==='url'||!r.digest)) add('reference_invalid','references',null,null,true);
  if(r.status==='human_asserted'&&(r.reference.kind!=='url'||!context.external_confirmations.some(c=>canonical(c.reference)===key&&Date.parse(c.confirmed_at)<=Date.parse(context.evaluated_at)))) add('reference_missing','references',null,null,true);
  if(r.status==='deleted_declared'&&(r.reference.kind!=='file'||!context.change_inventory.some(c=>c.operation==='deleted'&&c.path===r.reference.target&&c.base_digest))) add('reference_invalid','references',null,null,true);
  if(r.reference.kind==='id'&&r.status==='local_verified'&&(!graph.nodes.has(r.reference.target)||r.digest!==digest(canonical(graph.nodes.get(r.reference.target))))) add('reference_invalid','references',null,null,true);
  if(r.reference.kind==='file'&&context.change_inventory.some(c=>c.path===r.reference.target&&c.operation==='deleted')&&r.status!=='deleted_declared') add('reference_invalid','references',null,null,true);
  if(r.status==='deleted_declared'&&r.digest!==null) add('reference_invalid','references',null,null,true);
 }
 for(const n of graph.nodes.values()){
  if(!needed.has(n.id)) continue;
  const r=byRef.get(canonical(n.ref));
  if(!r||!['local_verified','human_asserted','deleted_declared'].includes(r.status)) add('reference_missing','traceability/nodes',n.id);
 }
 for(const stage of workflowInput.plan.stages){
  if(stage.selection==='skipped'||workflowInput.state.stages.find(s=>s.stage_id===stage.stage_id)?.status!=='completed') continue;
  for(const reference of stage.artifacts){
   if(![...graph.nodes.values()].some(n=>canonical(n.ref)===canonical(reference))) add('inventory_mismatch','plan/artifacts',null,null,true);
   const r=byRef.get(canonical(reference));if(!r||!['local_verified','human_asserted','deleted_declared'].includes(r.status)) add('reference_missing','plan/artifacts');
  }
 }
 return [...byRef.values()].sort((a,b)=>compare(canonical(a.reference),canonical(b.reference)));
}
