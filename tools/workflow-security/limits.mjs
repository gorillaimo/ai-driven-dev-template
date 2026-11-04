import { types } from 'node:util';
import { canonical } from 'workflow-rules/resolve';
export const MAX_BYTES=5*1024*1024;
export const MAX_RESULT=1024*1024;
// Inspect descriptors before evaluating schema/canonical JSON. Proxies are code too.
export function inspectJson(input,maxBytes=MAX_BYTES){
 const active=new Set(),stack=[{v:input,depth:0}];let nodes=0,bytes=0;
 while(stack.length){
  const {v,depth,leave}=stack.pop();if(leave){active.delete(v);continue;}
  if(++nodes>200000||depth>32)return 'input_limit';
  if(v===null||typeof v==='boolean')continue;
  if(typeof v==='string'){bytes+=Buffer.byteLength(v);if(bytes>maxBytes)return 'input_limit';continue;}
  if(typeof v==='number'){if(!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER)return 'input_invalid';continue;}
  if(typeof v!=='object'||types.isProxy(v))return 'input_invalid';
  const array=Array.isArray(v),proto=Object.getPrototypeOf(v);
  if(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)return 'input_invalid';
  if(active.has(v))return 'input_invalid';active.add(v);stack.push({v,leave:true});
  const descriptors=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(descriptors);
  if(keys.length>200000-nodes)return 'input_limit';
  if(array&&(keys.length!==v.length+1||keys.some(k=>k!=='length'&&(typeof k!=='string'||!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.length))))return 'input_invalid';
  for(const k of keys){if(array&&k==='length')continue;const d=descriptors[k];if(typeof k!=='string'||!d.enumerable||!('value'in d))return 'input_invalid';bytes+=Buffer.byteLength(k);if(bytes>maxBytes)return 'input_limit';stack.push({v:d.value,depth:depth+1});}
 }
 return Buffer.byteLength(canonical(input))>maxBytes?'input_limit':null;
}
