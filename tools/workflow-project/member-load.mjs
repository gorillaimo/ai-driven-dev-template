import { readLocal,parseYaml } from 'workflow-rules/load';
import { inspectJson,MAX_BYTES } from './limits.mjs';
export function loadProjectMembers(root,paths) {
  if(inspectJson(paths)||!paths||Array.isArray(paths)||typeof paths!=='object'||Object.keys(paths).some(k=>!['project','team','context'].includes(k))||
    ['project','team','context'].some(k=>typeof paths[k]!=='string'))throw Error('load_paths');
  const result={};let bytes=0;
  for(const key of ['project','team','context']) {
    let text;try{text=readLocal(root,paths[key]);}catch{throw Error('load_invalid');}
    bytes+=Buffer.byteLength(text);if(bytes>MAX_BYTES)throw Error('load_size');
    try{result[key]=parseYaml(text);}catch{throw Error('load_invalid');}
  }
  const error=inspectJson(result);if(error)throw Error(error==='input_limit'?'load_size':'load_invalid');return result;
}
