import {commandTemplate} from './commands.mjs';
import {inspectJson,MAX_RESULT} from './limits.mjs';
import {validateSecurityArtifact as validate} from './schema.mjs';
import {validateExecutionArtifact} from 'workflow-execution/schema';
import {hash,same,catalog as trustedCatalog,within,fresh,matches,diag,maxDiagnostics,finiteTimes} from './core.mjs';
export function planSecurityChecks(input){
 const result={schema_version:1,artifact_kind:'security-plan',status:'blocked',input_digest:null,domain:'unknown',inputs:null,checks:[],diagnostics:[]};
 const diagnostics=result.diagnostics,add=(c,i=0)=>diagnostics.push(diag(c,i));
 const bad=inspectJson(input);if(bad){add(bad);return result;}
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['profile','executionProfile','context','catalog'].includes(k))){add('input_invalid');return result;}
 const {profile:p,executionProfile:e,context:c,catalog}=input;
 if(!validate('profile',p).valid||!validate('context',c).valid||!validate('catalog',catalog).valid||!validateExecutionArtifact('profile',e).valid){add('schema_invalid');return result;}
 if(!finiteTimes(input)){add('time_invalid');return result;}
 const inputs=structuredClone(input);delete inputs.context.rechecks;result.inputs=inputs;result.input_digest=hash(inputs);result.domain=p.domain;
 if(!same(catalog,trustedCatalog))add('catalog_invalid');
 if(p.repository!==c.repository||p.repository!==e.repository||p.human_owner!==e.human_owner||!matches(p.execution_profile,e)||!matches(c.subject.profile,e)||p.catalog_digest!==hash(catalog)||c.profile_digest!==hash(p)||c.subject.work_id!=='issue-'+c.subject.issue_number)add('binding_mismatch');
 if(c.authorization.status!=='confirmed')add('authorization_invalid');
 if(Date.parse(p.reviewed_at)>Date.parse(c.evaluated_at)||Date.parse(p.expires_at)<=Date.parse(c.evaluated_at))add('time_invalid');
 if(!p.stop_severities.includes('critical')||!p.stop_severities.includes('high'))add('policy_invalid');
 if(Object.values(c.capabilities).some(v=>v!==true))add('capability_missing');
 if(c.inventory.image!==catalog.image)add('catalog_invalid');
 const facts=new Map();for(const f of c.facts){if(facts.has(f.fact_id))add('input_invalid');facts.set(f.fact_id,f);if(!fresh(f.observed_at,c.evaluated_at,p.max_age_seconds))add('time_invalid');}
 const paths=new Set();for(const target of c.targets){if(paths.has(target.path))add('input_invalid');paths.add(target.path);}
 const tools=new Map();for(const t of c.inventory.tools){if(tools.has(t.tool_id))add('input_invalid');tools.set(t.tool_id,t);}
 const dbs=new Map();for(const db of c.inventory.databases){if(dbs.has(db.ecosystem))add('input_invalid');dbs.set(db.ecosystem,db);}
 const checks=new Set(),covered=new Set();
 for(const [index,check]of p.checks.entries()){
  const row={check_id:check.check_id,tool_id:check.tool_id,required:check.required,applicability:check.required?'required':'optional',status:'ready',targets:[],formats:[...check.formats],exclusions:check.exclusions.map(x=>x.path)};
  result.checks.push(row);
  if(checks.has(check.check_id))add('policy_invalid',index);checks.add(check.check_id);
  if(check.when){const f=facts.get(check.when.fact_id);if(!f||f.value==='unknown'){row.applicability='unknown';row.status='not_evaluated';add('condition_unknown',index);continue;}if(f.value!==check.when.equals){row.applicability='not_applicable';row.status='not_applicable';continue;}}
  for(const ac of check.acs)covered.add(ac);
  const tool=catalog.tools.find(t=>t.tool_id===check.tool_id),inventory=tools.get(check.tool_id);
  if(!tool){row.status='not_evaluated';if(check.required)add('unsupported',index);continue;}
  if(!inventory||inventory.version!==tool.version||inventory.archive_digest!==tool.sha256){row.status='not_evaluated';add('catalog_invalid',index);}
  if(!check.acs.length||!e.commands.some(x=>x.command_id===check.command_id&&x.executable===tool.binary&&same(x.argv,commandTemplate(tool.tool_id)))||!e.checks.some(x=>x.check_id===check.check_id&&x.kind==='verification'&&x.command_id===check.command_id&&x.domain===(p.domain==='app'?'app':'template')&&check.acs.every(a=>x.acs.includes(a))))add('policy_invalid',index);
  if(check.targets.some(t=>!within(t,e.allowed_paths)||within(t,e.forbidden_paths)))add('scope_invalid',index);
  if(check.formats.some(f=>!tool.formats.includes(f))) {row.status='not_evaluated';if(check.required)add('unsupported',index);}
  if(check.tool_id==='semgrep'&&p.languages.some(f=>!tool.formats.includes(f))) {row.status='not_evaluated';if(check.required)add('unsupported',index);}
  for(const exclusion of check.exclusions)if(!within(exclusion.path,check.targets)||Date.parse(exclusion.expires_at)<=Date.parse(c.evaluated_at)||!exclusion.reason.trim())add('exclusion_invalid',index);
  row.targets=c.targets.filter(t=>within(t.path,check.targets)&&!within(t.path,row.exclusions)&&(check.tool_id==='gitleaks'||check.formats.includes(t.format))).map(t=>t.path);
  if(!row.targets.length){row.status='not_evaluated';if(check.required)add('target_missing',index);}
  if(row.targets.some(t=>within(t,e.forbidden_paths)))add('scope_invalid',index);
  if(check.tool_id==='osv')for(const ecosystem of check.formats){const db=dbs.get(ecosystem);if(!db){row.status='not_evaluated';add('database_missing',index);}else if((db.snapshot_kind==='public_snapshot'?db.source!=='https://osv-vulnerabilities.storage.googleapis.com/'+ecosystem+'/all.zip':c.purpose!=='tool_trial'||db.source!=='urn:ai-workflow:synthetic-osv-db')||!fresh(db.checked_at,c.evaluated_at,p.max_age_seconds)||Date.parse(db.fetched_at)>Date.parse(db.checked_at)){row.status='not_evaluated';add('database_stale',index);}}
 }
 if(p.coverage==='all_targets'&&c.targets.some(t=>!result.checks.some(r=>r.status==='ready'&&r.targets.includes(t.path))))add('scope_invalid');
 if(p.required_acs.some(ac=>!covered.has(ac)))add('policy_invalid');
 result.diagnostics=maxDiagnostics(diagnostics);result.status=result.diagnostics.length?'blocked':'pass';
 if(Buffer.byteLength(JSON.stringify(result))>MAX_RESULT)return {...result,status:'blocked',inputs:null,checks:[],diagnostics:[diag('output_limit')]};
 return result;
}
