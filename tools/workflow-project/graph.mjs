import { compare } from 'workflow-rules/resolve';
const unique = values => [...new Set(values)];

export function inspectGraph(project, plan, add, prefix='') {
  const features=new Map(),areas=new Map(),deps=new Map(),downstream=new Map(),issues=new Set(),works=new Set();
  for(const [n,a] of project.areas.entries()) {
    if(areas.has(a.area_id))add('duplicate_area',prefix+'project/areas/'+n,null,[a.area_id]);
    areas.set(a.area_id,a);
  }
  for(const [n,f] of plan.features.entries()) {
    if(features.has(f.feature_id))add('duplicate_feature',prefix+'deliveryPlan/features/'+n,f.feature_id);
    features.set(f.feature_id,f);downstream.set(f.feature_id,[]);
  }
  for(const [n,f] of plan.features.entries()) {
    const path=prefix+'deliveryPlan/features/'+n, seen=new Set();deps.set(f.feature_id,[]);
    for(const [j,dep] of f.depends_on.entries()) {
      const p=path+'/depends_on/'+j;
      if(!dep.reason.trim())add('invalid_reason',p,f.feature_id);
      if(seen.has(dep.feature_id))add('duplicate_dependency',p,f.feature_id,[dep.feature_id]);seen.add(dep.feature_id);
      if(dep.feature_id===f.feature_id)add('self_dependency',p,f.feature_id);
      if(!features.has(dep.feature_id))add('unknown_dependency',p,f.feature_id,[dep.feature_id]);
      else {deps.get(f.feature_id).push(dep.feature_id);downstream.get(dep.feature_id).push(f.feature_id);}
    }
    for(const id of f.area_ids)if(!areas.has(id))add('unknown_area',path+'/area_ids',f.feature_id,[id]);
    for(const [j,c] of f.constraints.entries()) {
      if(!c.reason.trim())add('invalid_reason',path+'/constraints/'+j,f.feature_id);
      if(c.area_id && !areas.has(c.area_id))add('unknown_area',path+'/constraints/'+j,f.feature_id,[c.area_id]);
      if(c.kind==='shared_area' && (!areas.get(c.area_id)?.shared || !f.area_ids.includes(c.area_id)))add('invalid_shared_area',path+'/constraints/'+j,f.feature_id);
    }
    for(const [j,r] of f.issue_refs.entries()) {
      const match=/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/([1-9][0-9]*)$/.exec(r.issue_ref);
      if(!match || match[1]!==project.repository || r.work_id!=='issue-'+match[2])add('invalid_issue_identity',path+'/issue_refs/'+j,f.feature_id);
      if(issues.has(r.issue_ref)||works.has(r.work_id))add('duplicate_issue',path+'/issue_refs/'+j,f.feature_id);
      issues.add(r.issue_ref);works.add(r.work_id);
    }
  }
  for(const ds of deps.values())ds.sort(compare);
  const done=new Set(),active=new Set(),topo=[];
  for(const start of [...features.keys()].sort(compare)) {
    if(done.has(start))continue;
    const stack=[{id:start,index:0}];active.add(start);
    while(stack.length) {
      const frame=stack.at(-1), edges=deps.get(frame.id);
      if(frame.index===edges.length){active.delete(frame.id);done.add(frame.id);topo.push(frame.id);stack.pop();continue;}
      const next=edges[frame.index++];
      if(active.has(next)){
        const cycle=stack.slice(stack.findIndex(f=>f.id===next)).map(f=>f.id);cycle.push(next);
        add('dependency_cycle',prefix+'deliveryPlan/features',frame.id,cycle);
      } else if(!done.has(next)){active.add(next);stack.push({id:next,index:0});}
    }
  }
  return {features,areas,deps,downstream,topo};
}

// Sorted prefix merge is linear in the two path lists, rather than their product.
function overlaps(a,b) {
  let i=0,j=0;
  while(i<a.length&&j<b.length) {
    const x=a[i],y=b[j];
    if(x===y||x.startsWith(y+'/')||y.startsWith(x+'/'))return true;
    // Comparing slash-terminated paths keeps prefix descendants contiguous.
    if(compare(x+'/',y+'/')<0)i++;else j++;
  }
  return false;
}
export function attachConflicts(graph) {
  const ids=[...graph.areas.keys()].sort(compare),bits=new Map(ids.map((id,n)=>[id,1n<<BigInt(n)]));
  const paths=new Map(ids.map(id=>[id,unique(graph.areas.get(id).paths).sort((a,b)=>compare(a+'/',b+'/'))]));
  const neighbor=new Map();
  for(const a of ids){let mask=0n;for(const b of ids)if(a===b||overlaps(paths.get(a),paths.get(b)))mask|=bits.get(b);neighbor.set(a,mask);}
  const mask=new Map(),conflictMask=new Map();
  for(const [id,f] of graph.features){let own=0n,other=0n;for(const a of f.area_ids){own|=bits.get(a);other|=neighbor.get(a);}mask.set(id,own);conflictMask.set(id,other);}
  graph.conflicts=(a,b)=>(mask.get(a)&conflictMask.get(b))!==0n;
  graph.conflictAreas=(a,b)=>{
    for(const x of [...graph.features.get(a).area_ids].sort(compare))for(const y of [...graph.features.get(b).area_ids].sort(compare))if((bits.get(x)&neighbor.get(y))!==0n)return unique([x,y]).sort(compare);
    return [];
  };
  return graph;
}
