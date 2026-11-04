import {scannerArgv} from './commands.mjs';
import {inspectJson} from './limits.mjs';
import {hash,catalog,diag,within} from './core.mjs';
import {planSecurityChecks} from './plan.mjs';
import {same} from './core.mjs';
const source=(id,digest)=>({kind:'source',id,revision:1,digest,location:{kind:'id',target:id}});
export function normalizeScanResult(input){
 if(inspectJson(input,15*1024*1024))return {status:'error',diagnostics:[diag('input_invalid')]};
 const {toolId,rawResult,receipt,context}=input;
 if(!context?.plan?.inputs||!receipt)return {status:'error',diagnostics:[diag('input_invalid')]};
 const plan=context.plan,inputs=plan.inputs,p=inputs.profile,c=inputs.context;
 const check=p.checks.find(x=>x.check_id===context.check_id),selection=plan.checks.find(x=>x.check_id===context.check_id),tool=catalog.tools.find(x=>x.tool_id===toolId);
 const diagnostics=[],findings=[];let status='passed',parsed;
 const add=code=>{diagnostics.push(diag(code));status='error';};
 const safeReceipt={operation_id:/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(receipt?.operation_id??'')?receipt.operation_id:'invalid-operation',started_at:Number.isFinite(Date.parse(receipt.started_at))?receipt.started_at:c.evaluated_at,finished_at:Number.isFinite(Date.parse(receipt.finished_at))?receipt.finished_at:c.evaluated_at,exit_code:Number.isSafeInteger(receipt?.exit_code)?receipt.exit_code:null,completed:receipt?.completed===true,stopped:receipt?.stopped===true,timed_out:receipt?.timed_out===true,output_limited:receipt?.output_limited===true,version:/^[0-9]+\.[0-9]+\.[0-9]+$/.test(receipt.version??'')?receipt.version:'',target_count:Number.isSafeInteger(receipt?.target_count)&&receipt.target_count>=0&&receipt.target_count<=10000?receipt.target_count:0};
 if(!same(planSecurityChecks(inputs),plan)||plan.status!=='pass'||!tool||check?.tool_id!==toolId||selection?.status!=='ready')add('evidence_invalid');
 if(!Number.isFinite(Date.parse(receipt.started_at))||!Number.isFinite(Date.parse(receipt.finished_at)))add('time_invalid');
 if(!safeReceipt.completed||!safeReceipt.stopped||safeReceipt.timed_out||safeReceipt.output_limited||safeReceipt.target_count!==selection.targets.length||!safeReceipt.target_count||receipt.version!==tool?.version||Date.parse(safeReceipt.started_at)>Date.parse(safeReceipt.finished_at)||!Number.isFinite(Date.parse(safeReceipt.started_at))||!Number.isFinite(Date.parse(safeReceipt.finished_at))||Date.parse(safeReceipt.finished_at)-Date.parse(safeReceipt.started_at)>p.limits.timeout_seconds*1000||![0,tool?.finding_exit].includes(safeReceipt.exit_code))add('execution_error');
 if(typeof rawResult!=='string'||!rawResult.length||Buffer.byteLength(rawResult)>p.limits.max_raw_bytes)add('output_limit');
 if(!diagnostics.length){try{parsed=JSON.parse(rawResult);if(inspectJson(parsed))throw Error();}catch{add('evidence_invalid');}}
 const finding=(rule,path,line,severity)=>{
  const cleanPath=typeof path==='string'?path.replace(/^\/src\//,'').replace(/^\.\//,''):'';
  if(typeof rule!=='string'||!rule.length||rule.length>256||!selection.targets.includes(cleanPath)||(line!==null&&(!Number.isInteger(line)||line<1||line>10000000))){add('evidence_invalid');return;}
  const normalizedSeverity=typeof severity==='string'?severity.toLowerCase():'unknown',safeSeverity=['critical','high','medium','low','info'].includes(normalizedSeverity)?normalizedSeverity:'unknown';
  const item={rule_id:hash(String(rule)),path:cleanPath,line,severity:safeSeverity,status:'open',required_ac:check.acs.length>0};
  item.finding_id=hash({tool_id:toolId,rule_id:item.rule_id,path:item.path,line:item.line});findings.push(item);
  if(findings.length>1000)add('input_limit');
 };
 if(parsed!==undefined){try{
  if(toolId==='gitleaks'){if(!Array.isArray(parsed))add('evidence_invalid');else for(const row of parsed)finding(row.RuleID,row.File,row.StartLine,'critical');}
  if(toolId==='semgrep'){
   if(!Array.isArray(parsed.results)||!Array.isArray(parsed.errors)||parsed.errors.length||!Array.isArray(parsed.paths?.scanned)||!parsed.paths.scanned.length||parsed.version!==tool.version)add('evidence_invalid');
   else for(const row of parsed.results)finding(row.check_id,row.path,row.start?.line,row.extra?.metadata?.security_severity??({ERROR:'high',WARNING:'medium',INFO:'low'}[row.extra?.severity]));
  }
  if(toolId==='osv'){
   let packages=0,registryPackages=0;if(!Array.isArray(parsed.results))add('evidence_invalid');else for(const group of parsed.results){if(!Array.isArray(group.packages)){add('evidence_invalid');continue;}for(const row of group.packages){packages++;if(!row.package?.purl?.includes('source=LOCAL'))registryPackages++;if(!row.package||!Array.isArray(row.vulnerabilities??[])){add('evidence_invalid');continue;}for(const vuln of row.vulnerabilities??[]){const groupScore=Number(row.groups?.find(g=>g.ids?.includes(vuln.id))?.max_severity);const scoreSeverity=Number.isFinite(groupScore)?groupScore>=9?'critical':groupScore>=7?'high':groupScore>=4?'medium':'low':'unknown';finding(vuln.id,group.source?.path,null,vuln.database_specific?.severity??scoreSeverity);}}}if(!packages)add('target_missing');else if(!registryPackages)add('unsupported');
  }
  if(toolId==='trivy'){
   if(parsed.SchemaVersion!==2||!Array.isArray(parsed.Results)||!parsed.Results.length)add('evidence_invalid');else for(const group of parsed.Results){if(!group.MisconfSummary&&!Array.isArray(group.Vulnerabilities))add('evidence_invalid');for(const row of group.Misconfigurations??[])if(row.Status==='FAIL')finding(row.ID,group.Target,row.CauseMetadata?.StartLine||null,row.Severity);for(const row of group.Vulnerabilities??[])finding(row.VulnerabilityID,group.Target,null,row.Severity);}
  }
  }catch{add('evidence_invalid');}
  if(!diagnostics.length&&(findings.length||safeReceipt.exit_code===tool.finding_exit))status='failed';
  if(findings.length&&safeReceipt.exit_code===0)add('evidence_invalid');
  if(!findings.length&&safeReceipt.exit_code===tool.finding_exit)add('evidence_invalid');
 }
 const inputDigest=hash({toolId,raw_digest:hash(typeof rawResult==='string'?rawResult:''),receipt:safeReceipt}),resultId='security-'+hash({check_id:context.check_id,operation_id:safeReceipt.operation_id}).slice(0,32);
 const verification={schema_version:1,artifact_kind:'verification',artifact_id:resultId,revision:1,repository:c.repository,recorded_at:safeReceipt.finished_at,recorded_by:c.recorded_by,input_digest:inputDigest,evidence_refs:[source('security-receipt',hash(safeReceipt))],subject:structuredClone(c.subject),check_id:context.check_id,domain:p.domain==='app'?'app':'template',acs:[...check.acs],command_id:check.command_id,argv_redacted:scannerArgv(toolId,selection.targets),environment:'linux-amd64-docker-network-none',tool_version:safeReceipt.version||'unverified',started_at:safeReceipt.started_at,finished_at:safeReceipt.finished_at,status,exit_code:safeReceipt.exit_code,test_count:null,scope:[...selection.targets],log_refs:[source('security-result',inputDigest)]};
 return {schema_version:1,artifact_kind:'security-result',check_id:context.check_id,tool_id:toolId,domain:p.domain,subject:structuredClone(c.subject),plan_digest:hash(plan),profile_digest:hash(p),catalog_digest:hash(inputs.catalog),input_digest:inputDigest,status,started_at:safeReceipt.started_at,finished_at:safeReceipt.finished_at,tool_version:safeReceipt.version,rules_digest:hash(inputs.catalog.rules),intelligence:{kind:toolId==='osv'?'vulnerability_snapshot':'rules',snapshots:toolId==='osv'?c.inventory.databases.filter(d=>check.formats.includes(d.ecosystem)):[]},receipt:safeReceipt,findings:findings.slice(0,1000),verification,diagnostics:diagnostics.slice(0,1000)};
}
