import { isDeepStrictEqual } from 'node:util';
export const adapterNames = ['rules','plan','workflow','trace','brownfield','project_plan','project_members','project_aggregate','project_recommend'];
export function validateNormalization(paths) {
  if (!Array.isArray(paths) || new Set(paths).size !== paths.length || paths.some(p=>p!=='/duration_ms')) throw new Error('normalization_invalid');
}
const escape = key => String(key).replace(/~/g,'~0').replace(/\//g,'~1');
// Do not expose arbitrary object keys in diagnostics.
const publicKey = key => /^[a-zA-Z0-9_-]{1,64}$/.test(key) ? escape(key) : '<key>';
export function compareSnapshot(actual, expected, normalize=[]) {
  validateNormalization(normalize);
  actual=structuredClone(actual);expected=structuredClone(expected);
  for(const path of normalize){
    if(typeof actual?.duration_ms!=='number'||typeof expected?.duration_ms!=='number')throw new Error('normalization_invalid');
    delete actual.duration_ms;delete expected.duration_ms;
  }
  const paths=[];
  function walk(a,b,path){
    if(isDeepStrictEqual(a,b))return;
    if(paths.length>=64)return;
    if(a===null||b===null||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b)){paths.push(path);return;}
    if(Array.isArray(a)){
      if(a.length!==b.length)paths.push(path+'/length');
      for(let i=0;i<Math.min(a.length,b.length);i++)walk(a[i],b[i],path+'/'+i);
    }else for(const key of [...new Set([...Object.keys(a),...Object.keys(b)])].sort()){
      const next=path+'/'+publicKey(key);
      if(!Object.hasOwn(a,key)||!Object.hasOwn(b,key))paths.push(next);else walk(a[key],b[key],next);
      if(paths.length>=64)break;
    }
  }
  walk(actual,expected,'');return paths.slice(0,64);
}
const pointerPattern=/^(?:\/(?:[^~]|~[01])*)*$/;
export function validateForbidden(rules) {
  if(!Array.isArray(rules)||rules.length>128)throw new Error('forbidden_invalid');
  for(const rule of rules){
    if(!rule||typeof rule!=='object'||Array.isArray(rule)||Object.keys(rule).sort().join(',')!=='adapter,op,path,value'||
       !adapterNames.includes(rule.adapter)||!['equals','contains','text'].includes(rule.op)||typeof rule.path!=='string'||!pointerPattern.test(rule.path)||
       (rule.op==='text'&&(typeof rule.value!=='string'||!rule.value.length)))throw new Error('forbidden_invalid');
  }
}
function lookup(value,path){
  if(path==='')return {found:true,value};
  for(const key of path.slice(1).split('/').map(k=>k.replace(/~1/g,'/').replace(/~0/g,'~'))){
    if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))return {found:false};value=value[key];
  }
  return {found:true,value};
}
function subset(value,pattern){
  if(isDeepStrictEqual(value,pattern))return true;
  if(Array.isArray(value))return value.some(v=>subset(v,pattern));
  if(value===null||pattern===null||typeof value!=='object'||typeof pattern!=='object'||Array.isArray(pattern))return false;
  return Object.keys(pattern).every(k=>Object.hasOwn(value,k)&&subset(value[k],pattern[k]));
}
export function checkForbidden(outputs,rules){
  validateForbidden(rules);const findings=[];
  for(const [index,rule] of rules.entries()){
    if(!Object.hasOwn(outputs,rule.adapter))throw new Error('forbidden_adapter_missing');
    const item=lookup(outputs[rule.adapter],rule.path);if(!item.found)continue;
    const found=rule.op==='equals'?isDeepStrictEqual(item.value,rule.value):rule.op==='contains'?subset(item.value,rule.value):JSON.stringify(item.value).includes(rule.value);
    if(found)findings.push({code:'forbidden_output',adapter:rule.adapter,rule:index});
  }return findings;
}
