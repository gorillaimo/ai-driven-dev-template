import { canonical } from 'workflow-rules/resolve';
const pairs = {
 satisfies: { requirement:['acceptance_criterion'] },
 implements: { design:['requirement'], api:['design'], change:['design','requirement','acceptance_criterion'] },
 verifies: { test:['acceptance_criterion','requirement','design','api'], validation:['test','change','quality_gate'] },
 excludes: { non_scope:['requirement','design','api','test','change'] },
 follows_up: { open_question:['follow_up'], remaining_work:['follow_up'] },
};
export function inspectGraph(trace, add) {
 const nodes = new Map(), outgoing = new Map(), incoming = new Map(), edges = new Set();
 for(const n of trace.nodes){
  if(nodes.has(n.id)) add('duplicate_node','traceability/nodes',n.id);
  else {nodes.set(n.id,n);outgoing.set(n.id,[]);incoming.set(n.id,[]);}
  if(n.status==='not_applicable'&&!n.reason?.trim()) add('node_incomplete','traceability/nodes',n.id);
 }
 for(const edge of trace.links){
  const key=canonical(edge);
  if(edges.has(key)) add('duplicate_link','traceability/links',null,edge);
  edges.add(key);
  const from=nodes.get(edge.from),to=nodes.get(edge.to);
  if(!from||!to){add('unknown_endpoint','traceability/links',null,edge);continue;}
  if(from.id===to.id) add('self_link','traceability/links',from.id,edge);
  if(edge.relation!=='references'&&!pairs[edge.relation]?.[from.kind]?.includes(to.kind)){
   add('invalid_relation','traceability/links',from.id,edge);continue;
  }
  outgoing.get(from.id).push(edge);incoming.get(to.id).push(edge);
  if(edge.relation==='excludes'&&to.status!=='not_applicable') add('non_scope_violation','traceability/links',to.id,edge,true);
 }
 for(const n of nodes.values()) if(!['acceptance_criterion','non_scope','feature','open_question','remaining_work','follow_up'].includes(n.kind)&&!outgoing.get(n.id).length&&!incoming.get(n.id).length) add('orphan_node','traceability/nodes',n.id);
 const cache=new Map();
 function ancestors(id){
  if(cache.has(id)) return cache.get(id);
  const found=new Set(),seen=new Set(),pending=[id];
  while(pending.length){
   const current=pending.pop();if(seen.has(current)) continue;seen.add(current);
   const n=nodes.get(current);if(!n||n.status==='not_applicable') continue;
   if(n.kind==='acceptance_criterion') found.add(current);
   for(const e of outgoing.get(current)) if(['satisfies','implements','verifies'].includes(e.relation)) pending.push(e.to);
  }
  cache.set(id,found);return found;
 }
 return {nodes,outgoing,incoming,ancestors};
}
