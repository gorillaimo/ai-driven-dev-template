import { readLocal, parseYaml } from 'workflow-rules/load';
import { inspectJson, countLimit, arrays, MAX_BYTES } from './limits.mjs';
const scalar=['profile','grant','context','report'],lists=[...arrays,'events'];
export function loadExecutionEvidence(root,paths){
 try{
  if(inspectJson(paths))throw Error();let bytes=0;const seen=new Set();
  const read=path=>{if(typeof path!=='string'||seen.has(path))throw Error();seen.add(path);const raw=readLocal(root,path);bytes+=Buffer.byteLength(raw);if(bytes>MAX_BYTES)throw Error();return parseYaml(raw);};
  const load=(set,previous=false)=>{
   if(!set||typeof set!=='object'||Array.isArray(set)||Object.keys(set).some(k=>![...scalar,...lists,...(previous?[]:['previous'])].includes(k))||['profile','grant','context',...arrays].some(k=>!Object.hasOwn(set,k)))throw Error();
   const result={};for(const k of scalar)if(Object.hasOwn(set,k))result[k]=read(set[k]);
   for(const k of lists)if(Object.hasOwn(set,k)){if(!Array.isArray(set[k])||set[k].length>(k==='events'?10000:128))throw Error();result[k]=set[k].map(read);}
   if(Object.hasOwn(set,'previous'))result.previous=load(set.previous,true);return result;
  };
  const result=load(paths);if(inspectJson(result)||countLimit(result))throw Error();return result;
 }catch{throw Error('execution_load_invalid');}
}
