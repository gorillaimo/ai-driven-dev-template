import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { resolveRules, validateArtifact as validateRules } from '../workflow-rules/resolve.mjs';
import { projectPlan } from '../workflow-rules/plan.mjs';
import { checkWorkflow, validateArtifact as validateWorkflow } from '../workflow-check/check.mjs';
import { checkTraceability, validateArtifact as validateTrace } from '../workflow-trace/check.mjs';
const ajv=new Ajv({strict:true,allErrors:true});addFormats(ajv);
for(const kind of ['common','brownfield'])ajv.addSchema(JSON.parse(readFileSync(new URL('../../.ai-workflow/schemas/issue/v1/'+kind+'.schema.json',import.meta.url),'utf8')));
const validateBrownfield=ajv.getSchema('urn:ai-workflow:issue:v1:brownfield');
export function evaluate(adapter,input){
 let output;
 switch(adapter){
  case 'rules':output=resolveRules(input);if(!validateRules('resolution',output).valid)throw new Error('result_invalid');break;
  case 'plan':output=projectPlan(input.plan,resolveRules(input.ruleInput),input.ruleInput);if(!validateWorkflow('plan',output))throw new Error('result_invalid');break;
  case 'workflow':output=checkWorkflow(input);if(!validateWorkflow('result',output))throw new Error('result_invalid');break;
  case 'trace':output=checkTraceability(input);if(!validateTrace('result',output))throw new Error('result_invalid');break;
  case 'brownfield':{
   const valid=!!validateBrownfield(input);
   output={schema_version:1,status:valid?'pass':'blocked',diagnostics:valid?[]:[{code:'schema_invalid'}]};break;
  }
  default:throw new Error('adapter_unknown');
 }
 return output;
}
