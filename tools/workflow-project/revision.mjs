import { canonical, compare } from 'workflow-rules/resolve';
const same=(a,b)=>canonical(a)===canonical(b);
const sort=values=>[...values].sort(compare);

export function inspectHistory(plan, add, prefix='') {
  const history=plan.revision_history;
  if(history.length!==plan.revision-1)add('revision_invalid',prefix+'deliveryPlan/revision_history');
  for(const [n,r] of history.entries()) {
    if(r.revision!==n+2)add('revision_invalid',prefix+'deliveryPlan/revision_history/'+n);
    if(!r.reason.trim())add('invalid_reason',prefix+'deliveryPlan/revision_history/'+n);
  }
}

export function inspectRevision(current, previous, graph, oldGraph, records, oldRecords, oldWaves, add) {
  const result={changed_feature_ids:[],affected_feature_ids:[],invalidated_waves:[],active_decisions:[]};
  if(!previous){if(current.deliveryPlan.revision>1)add('previous_required','previous');return result;}
  const plan=current.deliveryPlan, old=previous.deliveryPlan;
  if(current.project.project_id!==previous.project.project_id||plan.project_id!==old.project_id)add('identity_mismatch','previous');
  if(plan.revision<old.revision||plan.revision>old.revision+1||current.project.revision<previous.project.revision)add('revision_invalid','previous');
  if(current.project.revision===previous.project.revision&&!same(current.project,previous.project))add('revision_invalid','project/revision');
  if(plan.revision===old.revision) {
    if(!same(plan,old)||!same(current.project.areas,previous.project.areas))add('revision_invalid','deliveryPlan/revision');
    return result;
  }
  if(plan.revision!==old.revision+1)return result;
  if(!same(plan.revision_history.slice(0,-1),old.revision_history))add('history_rewritten','deliveryPlan/revision_history');
  const entry=plan.revision_history.at(-1);
  if(!entry||entry.revision!==plan.revision){add('revision_invalid','deliveryPlan/revision_history');return result;}
  const all=new Set([...graph.features.keys(),...oldGraph.features.keys()]), changed=new Set(),affected=new Set();
  let priorityChanged=false;
  for(const id of all) {
    const a=graph.features.get(id),b=oldGraph.features.get(id);
    if(!same(a??null,b??null)){changed.add(id);affected.add(id);}
    if(a&&b&&a.planned_priority!==b.planned_priority)priorityChanged=true;
  }
  if(priorityChanged)for(const id of all)affected.add(id);
  const areaIds=new Set([...graph.areas.keys(),...oldGraph.areas.keys()]);
  for(const a of areaIds)if(!same(graph.areas.get(a)??null,oldGraph.areas.get(a)??null)) {
    for(const g of [graph,oldGraph])for(const [id,f] of g.features)if(f.area_ids.includes(a))affected.add(id);
  }
  // Close over both graphs, including peers sharing an area and their downstream.
  const queue=[...affected];
  for(let n=0;n<queue.length;n++)for(const g of [oldGraph,graph]) {
    const id=queue[n];if(!g.features.has(id))continue;
    const neighbors=[...g.downstream.get(id)];
    for(const peer of g.features.keys())if(peer!==id&&g.conflicts(id,peer))neighbors.push(peer);
    for(const next of neighbors)if(!affected.has(next)){affected.add(next);queue.push(next);}
  }
  const invalidated=new Set();
  for(const w of oldWaves.waves)if(w.feature_ids.some(id=>affected.has(id)))invalidated.add(w.wave);
  for(const id of affected)if(!entry.affected_feature_ids.includes(id))add('impact_missing','deliveryPlan/revision_history',id);
  for(const id of entry.affected_feature_ids)if(!all.has(id))add('impact_unknown','deliveryPlan/revision_history',id);
  for(const w of invalidated)if(!entry.invalidated_waves.includes(w))add('waves_missing','deliveryPlan/revision_history');
  const knownWaves=new Set(oldWaves.waves.map(w=>w.wave));
  for(const w of entry.invalidated_waves)if(!knownWaves.has(w))add('wave_unknown','deliveryPlan/revision_history');
  for(const id of sort(affected)) {
    if(records.facts.get(id)?.state!=='active'&&oldRecords.facts.get(id)?.state!=='active')continue;
    const decision=records.decisions.get(id);
    if(!decision)add('active_decision_required','context/replan_decisions',id);
    else result.active_decisions.push({feature_id:id,decision:decision.decision});
    if(oldRecords.facts.get(id)?.state==='active'&&records.facts.get(id)?.state==='planned')add('active_state_regression','context/feature_facts',id);
  }
  result.changed_feature_ids=sort(changed);result.affected_feature_ids=sort(affected);result.invalidated_waves=[...invalidated].sort((a,b)=>a-b);
  return result;
}
