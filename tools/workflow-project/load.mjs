import { readLocal, parseYaml } from 'workflow-rules/load';
import { MAX_BYTES, inspectJson } from './limits.mjs';

// Only caller-specified snapshots are read; no repository walking or URL fetches.
export function loadProjectPlan(root, paths) {
  if(inspectJson(paths))throw Error('load_paths');
  let bytes=0;
  const readSet=(set,allowPrevious)=>{
    if(!set||typeof set!=='object'||Array.isArray(set)||
      Object.keys(set).some(k=>!['project','deliveryPlan','context',...(allowPrevious?['previous']:[])].includes(k))||
      ['project','deliveryPlan','context'].some(k=>typeof set[k]!=='string'))throw Error('load_paths');
    const result={};
    for(const key of ['project','deliveryPlan','context']) {
      let raw;
      try{raw=readLocal(root,set[key]);}catch{throw Error('load_invalid');}
      bytes+=Buffer.byteLength(raw);if(bytes>MAX_BYTES)throw Error('load_size');
      try{result[key]=parseYaml(raw);}catch{throw Error('load_invalid');}
    }
    if(allowPrevious&&set.previous!==undefined)result.previous=readSet(set.previous,false);
    return result;
  };
  const result=readSet(paths,true),error=inspectJson(result);
  if(error)throw Error(error==='input_limit'?'load_size':'load_invalid');
  return result;
}
