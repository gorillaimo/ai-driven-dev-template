import { readLocal,parseYaml } from 'workflow-rules/load';
import { loadWorkflow } from 'workflow-check/load';
import { collectReferences } from './references.mjs';
import { validateArtifact } from './check.mjs';
export function loadTraceability(root,paths,ruleContext,optIns=[]){
 const traceability=parseYaml(readLocal(root,paths.traceability));
 const context=parseYaml(readLocal(root,paths.context));
 if(!validateArtifact('traceability',traceability)||!validateArtifact('context',context)) throw new Error('schema_invalid');
 const workflowInput=loadWorkflow(root,paths.workflow,ruleContext,optIns);
 const input={traceability,context,workflowInput};
 return {...input,references:collectReferences(root,input)};
}
