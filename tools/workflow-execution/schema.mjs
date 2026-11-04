import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { inspectJson } from './limits.mjs';
const ajv=new Ajv({strict:true,allErrors:false});addFormats(ajv);
const root=new URL('../../.ai-workflow/schemas/',import.meta.url);
ajv.addSchema(JSON.parse(readFileSync(new URL('issue/v1/common.schema.json',root),'utf8')));
const kinds=['common','profile','grant','verification','review','security-result','integration-result','run-report','event','context','result'];
for(const kind of kinds)ajv.addSchema(JSON.parse(readFileSync(new URL('execution/v1/'+kind+'.schema.json',root),'utf8')));
export function validateExecutionArtifact(kind,value){
 if(!kinds.includes(kind)||kind==='common')return {valid:false,diagnostics:[{code:'artifact_kind_invalid',artifact_kind:'input',index:0}]};
 const bad=inspectJson(value);if(bad)return {valid:false,diagnostics:[{code:bad,artifact_kind:kind,index:0}]};
 const valid=!!ajv.getSchema('urn:ai-workflow:execution:v1:'+kind)(value);
 return {valid,diagnostics:valid?[]:[{code:'schema_invalid',artifact_kind:kind,index:0}]};
}
