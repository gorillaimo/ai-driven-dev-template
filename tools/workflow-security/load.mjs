import {readLocal,parseYaml} from 'workflow-rules/load';
import {inspectJson} from './limits.mjs';
import {catalog} from './core.mjs';
export function loadSecurityInputs(root,paths){try{
 if(inspectJson(paths)||!paths||Object.keys(paths).some(k=>!['profile','executionProfile','context'].includes(k))||['profile','executionProfile','context'].some(k=>typeof paths[k]!=='string'))throw Error();
 const result={catalog:structuredClone(catalog)};for(const key of ['profile','executionProfile','context'])result[key]=parseYaml(readLocal(root,paths[key]));if(inspectJson(result))throw Error();return result;
}catch{throw Error('security_load_invalid');}}
