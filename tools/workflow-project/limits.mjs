import { canonical } from 'workflow-rules/resolve';
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_RESULT = 1024 * 1024;

// Inspect descriptors before reading values: JSON is data, never an accessor or code.
export function inspectJson(value) {
  const stack=[{value,depth:0}], active=new Set();let nodes=0, bytes=0;
  while(stack.length) {
    const entry=stack.pop();
    if(entry.leave){active.delete(entry.value);continue;}
    const {value:v,depth}=entry;
    if(++nodes>200000 || depth>32) return 'input_limit';
    if(v===null || typeof v==='boolean')continue;
    if(typeof v==='string'){bytes+=Buffer.byteLength(v);if(bytes>MAX_BYTES)return 'input_limit';continue;}
    if(typeof v==='number'){if(!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER)return 'input_invalid';continue;}
    if(typeof v!=='object')return 'input_invalid';
    const array=Array.isArray(v), prototype=Object.getPrototypeOf(v);
    if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)return 'input_invalid';
    if(active.has(v))return 'input_invalid';
    active.add(v);stack.push({value:v,leave:true});
    const descriptors=Object.getOwnPropertyDescriptors(v);
    const keys=Reflect.ownKeys(descriptors);
    if(array && (keys.length!==v.length+1||keys.some(k=>k!=='length'&&(typeof k!=='string'||!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.length))))return 'input_invalid';
    for(const key of keys) {
      if(array && key==='length')continue;
      const d=descriptors[key];
      if(typeof key!=='string'||!d.enumerable||!('value' in d))return 'input_invalid';
      bytes+=Buffer.byteLength(key);if(bytes>MAX_BYTES)return 'input_limit';
      stack.push({value:d.value,depth:depth+1});
    }
  }
  return Buffer.byteLength(canonical(value))>MAX_BYTES?'input_limit':null;
}

export function countLimit(snapshot) {
  const p=snapshot?.project, d=snapshot?.deliveryPlan, c=snapshot?.context;
  const over=(v,n)=>Array.isArray(v)&&v.length>n;
  if(over(p?.areas,200)||over(d?.features,1000)||over(d?.revision_history,100)||
     over(c?.feature_facts,1000)||over(c?.constraint_facts,10000)||over(c?.replan_decisions,1000))return true;
  const total=(rows,key)=>Array.isArray(rows)?rows.reduce((n,r)=>n+(Array.isArray(r?.[key])?r[key].length:0),0):0;
  return ['depends_on','constraints','issue_refs','area_ids'].some(k=>total(d?.features,k)>10000)||
    total(p?.areas,'paths')>10000||total(d?.revision_history,'affected_feature_ids')>10000||total(d?.revision_history,'invalidated_waves')>10000;
}
