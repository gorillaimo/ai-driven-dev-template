import { compare } from 'workflow-rules/resolve';

export function inspectFacts(snapshot, graph, add, prefix='', previousIds=[]) {
  const {context}=snapshot, facts=new Map(),conditions=new Map(),decisions=new Map();
  for(const [n,f] of context.feature_facts.entries()) {
    if(!graph.features.has(f.feature_id))add('unknown_fact',prefix+'context/feature_facts/'+n,f.feature_id);
    if(facts.has(f.feature_id))add('duplicate_fact',prefix+'context/feature_facts/'+n,f.feature_id);
    facts.set(f.feature_id,f);
  }
  for(const id of graph.features.keys())if(!facts.has(id))add('missing_fact',prefix+'context/feature_facts',id);
  for(const [n,f] of context.constraint_facts.entries()) {
    if(!graph.features.has(f.feature_id)||!graph.features.get(f.feature_id)?.constraints[f.constraint_index])add('unknown_fact',prefix+'context/constraint_facts/'+n,f.feature_id);
    const key=f.feature_id+':'+f.constraint_index;
    if(conditions.has(key))add('duplicate_fact',prefix+'context/constraint_facts/'+n,f.feature_id);
    conditions.set(key,f);
  }
  for(const [n,d] of context.replan_decisions.entries()) {
    if(!graph.features.has(d.feature_id)&&!previousIds.includes(d.feature_id))add('unknown_fact',prefix+'context/replan_decisions/'+n,d.feature_id);
    if(decisions.has(d.feature_id))add('duplicate_fact',prefix+'context/replan_decisions/'+n,d.feature_id);
    decisions.set(d.feature_id,d);
  }
  return {facts,conditions,decisions};
}

export function planWaves(graph, records) {
  const {facts,conditions}=records, waiting=new Map(),serialization=new Map();
  const ids=[...graph.features.keys()].sort(compare);
  const active=ids.filter(id=>facts.get(id).state==='active'), completed=ids.filter(id=>facts.get(id).state==='completed'),cancelled=ids.filter(id=>facts.get(id).state==='cancelled');
  const wait=(id,reason,related=[])=>{
    if(!waiting.has(id))waiting.set(id,{feature_id:id,reasons:new Set(),related:new Set()});
    const w=waiting.get(id);w.reasons.add(reason);for(const r of related)w.related.add(r);
  };
  for(const id of ids) {
    const state=facts.get(id).state;
    if(state==='blocked'||state==='unknown')wait(id,'state_'+state);
    if(state!=='planned')continue;
    graph.features.get(id).constraints.forEach((c,n)=>{
      const state=conditions.get(id+':'+n)?.state??'unknown';
      if(state!=='satisfied')wait(id,'constraint_'+state);
    });
    const conflicts=active.filter(a=>graph.conflicts(id,a));if(conflicts.length)wait(id,'active_area_conflict',conflicts);
  }
  // Dependencies are visited first, so waiting only needs one propagation pass.
  for(const id of graph.topo) {
    if(facts.get(id).state!=='planned')continue;
    const missing=graph.deps.get(id).filter(d=>waiting.has(d)||['active','blocked','cancelled','unknown'].includes(facts.get(d).state));
    if(missing.length)wait(id,'dependency_waiting',missing);
  }
  const remaining=new Set(ids.filter(id=>facts.get(id).state==='planned'&&!waiting.has(id))),assigned=new Map(),waves=[];
  const rank=(a,b)=>graph.features.get(a).planned_priority-graph.features.get(b).planned_priority||compare(a,b);
  while(remaining.size) {
    const ready=[...remaining].filter(id=>graph.deps.get(id).every(d=>facts.get(d).state==='completed'||assigned.has(d))).sort(rank);
    const chosen=[];
    for(const id of ready) {
      const conflict=chosen.find(other=>graph.conflicts(id,other));
      if(conflict)serialization.set(id,{feature_id:id,after_feature_ids:[conflict],area_ids:graph.conflictAreas(id,conflict),reason:'area_serialized'});
      else chosen.push(id);
    }
    if(!chosen.length)throw new Error('invalid_internal_graph');
    const wave=waves.length+1;
    waves.push({wave,feature_ids:chosen});for(const id of chosen){remaining.delete(id);assigned.set(id,wave);}
  }
  return {waves,dependency_candidates:(waves[0]?.feature_ids??[]).filter(id=>graph.deps.get(id).every(d=>facts.get(d).state==='completed')),
    waiting:[...waiting.values()].sort((a,b)=>compare(a.feature_id,b.feature_id)).map(w=>({feature_id:w.feature_id,reasons:[...w.reasons].sort(compare),related:[...w.related].sort(compare)})),
    active,completed,cancelled,serialization:[...serialization.values()].sort((a,b)=>compare(a.feature_id,b.feature_id))};
}
