import {planSecurityChecks} from './plan.mjs';
import {normalizeScanResult} from './normalize.mjs';
import {inspectJson} from './limits.mjs';
import {same,diag} from './core.mjs';
import {buildRequest} from './commands.mjs';
export async function runSecurityCheck({plan,checkId,workspace,outputDir},executor){
 if(inspectJson(plan)||!plan?.inputs||plan.status!=='pass'||!same(planSecurityChecks(plan.inputs),plan))return {status:'error',diagnostics:[diag('evidence_invalid')]};
 const check=plan.checks.find(x=>x.check_id===checkId);if(!check||check.status!=='ready')return {status:'not_evaluated',diagnostics:[diag('unsupported')]};
 try{const request=buildRequest({plan,check,workspace,outputDir});const {rawResult,receipt}=await executor.execute(request);return normalizeScanResult({toolId:check.tool_id,rawResult,receipt,context:{...plan.inputs.context,plan,check_id:checkId}});}catch(error){return {status:'error',diagnostics:[diag(error?.message==='stopped_unknown'?'stopped_unknown':'execution_error')]};}
}
