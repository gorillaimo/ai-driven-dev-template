import { types } from 'node:util';
import { canonical } from 'workflow-rules/resolve';
export const MAX_BYTES=5*1024*1024;
export const MAX_RESULT=1024*1024;
// Inspect descriptors before evaluating schema/canonical JSON. Proxies are code too.
export function inspectJson(input){
 const active=new Set(),stack=[{v:input,depth:0}];let nodes=0,bytes=0;
 while(stack.length){
  const {v,depth,leave}=stack.pop();if(leave){active.delete(v);continue;}
  if(++nodes>200000||depth>32)return 'input_limit';
  if(v===null||typeof v==='boolean')continue;
  if(typeof v==='string'){bytes+=Buffer.byteLength(v);if(bytes>MAX_BYTES)return 'input_limit';continue;}
  if(typeof v==='number'){if(!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER)return 'input_invalid';continue;}
  if(typeof v!=='object'||types.isProxy(v))return 'input_invalid';
  const array=Array.isArray(v),proto=Object.getPrototypeOf(v);
  if(array?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)return 'input_invalid';
  if(active.has(v))return 'input_invalid';active.add(v);stack.push({v,leave:true});
  const descriptors=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(descriptors);
  if(keys.length>200000-nodes)return 'input_limit';
  if(array&&(keys.length!==v.length+1||keys.some(k=>k!=='length'&&(typeof k!=='string'||!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.length))))return 'input_invalid';
  for(const k of keys){if(array&&k==='length')continue;const d=descriptors[k];if(typeof k!=='string'||!d.enumerable||!('value'in d))return 'input_invalid';bytes+=Buffer.byteLength(k);if(bytes>MAX_BYTES)return 'input_limit';stack.push({v:d.value,depth:depth+1});}
 }
 return Buffer.byteLength(canonical(input))>MAX_BYTES?'input_limit':null;
}
export const arrays=['verifications','reviews','securityResults','integrationResults'];
export function countLimit(input){
 const sets=[input,...(input?.previous?[input.previous]:[])];let records=0,checks=0,findings=0,events=0,selected=0;
 for(const s of sets){if(!s||typeof s!=='object')continue;for(const key of arrays){if(Array.isArray(s[key])){records+=s[key].length;for(const r of s[key])findings+=Array.isArray(r?.findings)?r.findings.length:0;}}checks+=s.profile?.checks?.length??0;events+=s.events?.length??0;selected+=s.grant?.selected?.length??0;}
 return records>128||checks>1000||findings>1000||events>10000||selected>100;
}
