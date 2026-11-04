import {readFileSync} from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {inspectJson} from './limits.mjs';
const ajv=new Ajv({strict:true,allErrors:false});addFormats(ajv);
const root=new URL('../../.ai-workflow/schemas/',import.meta.url);
for(const [namespace,kinds]of [['issue',['common']],['execution',['common','profile','verification','review']],['security',['common','profile','context','plan','result','report']]])for(const kind of kinds)ajv.addSchema(JSON.parse(readFileSync(new URL(namespace+'/v1/'+kind+'.schema.json',root),'utf8')));
export function validateSecurityArtifact(kind,value){if(inspectJson(value))return {valid:false};const urn=kind==='catalog'?'urn:ai-workflow:security:v1:common#/$defs/catalog':'urn:ai-workflow:security:v1:'+kind;if(!['profile','context','plan','result','report','catalog'].includes(kind))return {valid:false};return {valid:!!ajv.getSchema(urn)(value)};}
