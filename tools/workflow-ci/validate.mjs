// CI entry point for committed artifacts, not an orchestrator or an approval validator.
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parseYaml } from '../workflow-rules/load.mjs';
import { inspectReference } from '../workflow-trace/references.mjs';
import { messages } from './messages.mjs';
export const limits=Object.freeze({fileBytes:1048576,artifacts:100,totalBytes:20971520,reportBytes:1048576,directories:100});
const kinds=['plan','state','traceability','brownfield'];
const identityKeys=['work_id','work_source','issue_ref','project_id','feature_id'];
const ajv=new Ajv({strict:true,allErrors:true});addFormats(ajv);
for(const kind of ['common',...kinds])ajv.addSchema(JSON.parse(readFileSync(new URL('../../.ai-workflow/schemas/issue/v1/'+kind+'.schema.json',import.meta.url),'utf8')));
const validators=Object.fromEntries(kinds.map(k=>[k,ajv.getSchema('urn:ai-workflow:issue:v1:'+k)]));
const idPattern=/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const pathPattern=/^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const object=value=>value!==null&&typeof value==='object';
function safeStat(root,path){
 if(typeof path!=='string'||!pathPattern.test(path))throw new Error('unsafe_path');
 let target=root,stat;
 for(const segment of path.split('/')){
  target=join(target,segment);
  try{stat=lstatSync(target);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))throw new Error('unsafe_path');
 }
 return {target,stat};
}
export function validateRepository(repository){
 const report={format_version:1,status:'pass',artifact_count:0,excluded_count:0,reference_counts:{pass:0,block:0,not_evaluated:0},artifacts:[],diagnostics:[]};
 const add=(code,path='',location='',severity='block')=>{report.diagnostics.push({code,path,location,severity});if(severity==='block')report.status='blocked';};
 let root,totalBytes=0;const readPaths=new Set();
 function charge(path,stat){
  if(stat.size>limits.fileBytes)throw new Error('size_limit');
  if(!readPaths.has(path)){readPaths.add(path);totalBytes+=stat.size;if(totalBytes>limits.totalBytes)throw new Error('size_limit');}
 }
 function reference(ref,path,location,future,nodes){
  let code,status='pass';
  try{
   // Even a future reference must stay within safe repository paths.
   let local;
   if(ref.kind==='file'){
    local=safeStat(root,ref.target);if(local?.stat.isFile()&&local.stat.size>limits.fileBytes)throw new Error('size_limit');
   }
   if(future){status='not_evaluated';code='future_reference';}
   else if(ref.kind==='url'){status='not_evaluated';code='external_reference';}
   else if(ref.kind==='id'){
    if(!nodes){status='not_evaluated';code='id_not_evaluated';}
    else if(!nodes.has(ref.target)){status='block';code='reference_missing';}
   }else if(!local){status='block';code='reference_missing';}
   else if(ref.fragment){
    if(local.stat.isDirectory()){status='not_evaluated';code='fragment_not_evaluated';}
    else{
     charge(ref.target,local.stat);
     const result=inspectReference(root,ref);
     if(result.status==='missing'){status='block';code='reference_missing';}
     else if(result.status!=='local_verified'){status='not_evaluated';code='fragment_not_evaluated';}
    }
   }
  }catch(error){status='block';code=['unsafe_path','size_limit'].includes(error.message)?error.message:'reference_invalid';}
  report.reference_counts[status]++;
  if(code)add(code,path,location,status);
  return status;
 }
 function inspect(entry,group){
  const {value,kind,path,result}=entry;
  if(!value)return;
  let identityValid=value.work_id===group.id;
  if(value.work_source==='github_issue'&&value.work_id!=='issue-'+value.issue_ref.split('/').at(-1))identityValid=false;
  for(const other of group.entries.filter(e=>e.value))for(const key of identityKeys)if(value[key]!==other.value[key])identityValid=false;
  if(!identityValid)add('identity_mismatch',path);result.identity=identityValid?'pass':'block';
  let nodes;
  if(kind==='traceability'){
   nodes=new Set(value.nodes.map(n=>n.id));const edges=new Set();
   if(nodes.size!==value.nodes.length)add('trace_invalid',path,'/nodes');
   value.links.forEach((link,index)=>{
    const key=[link.from,link.to,link.relation].join('\0');
    if(edges.has(key)||!nodes.has(link.from)||!nodes.has(link.to))add('trace_invalid',path,'/links/'+index);
    edges.add(key);
   });
  }
  const statuses=[];
  function walk(v,location='',future=false){
   if(!object(v))return;
   if(['file','url','id'].includes(v.kind)&&typeof v.target==='string'){
    const namespace=kind==='traceability'&&(/^\/nodes\/\d+\/ref$/.test(location)||/^\/checks\/\d+\/references\/\d+$/.test(location))?nodes:undefined;
    statuses.push(reference(v,path,location,future,namespace));return;
   }
   if(Array.isArray(v)){v.forEach((child,index)=>walk(child,location+'/'+index,future));return;}
   for(const [key,child] of Object.entries(v)){
    if(key==='extensions')continue;
    let deferred=future;
    if(kind==='plan'&&/^\/stages\/\d+$/.test(location)&&key==='artifacts'){
     const state=group.entries.find(e=>e.kind==='state')?.value;
     const states=state?.stages.filter(s=>s.stage_id===v.stage_id)??[];
     deferred=v.selection==='skipped'||states.length!==1||states[0].status!=='completed';
    }
    if(kind==='traceability'&&/^\/nodes\/\d+$/.test(location)&&key==='ref')deferred=v.status!=='complete';
    if(kind==='brownfield'&&location===''&&['change_candidates','follow_up'].includes(key))deferred=true;
    if(kind==='brownfield'&&/^\/document_updates\/\d+$/.test(location)&&key==='target'){
     statuses.push(reference({kind:'file',target:child},path,location+'/target',true));continue;
    }
    walk(child,location+'/'+key,deferred);
   }
  }
  walk(value);
  result.references=report.diagnostics.some(d=>d.path===path&&d.code==='trace_invalid')||statuses.includes('block')?'block':statuses.includes('not_evaluated')?'not_evaluated':'pass';
 }
 try{
  if(lstatSync(repository).isSymbolicLink()||!lstatSync(repository).isDirectory())throw new Error('unsafe_path');
  root=realpathSync(repository);const dir=safeStat(root,'.ai-workflow/issues');
  if(!dir)return report;
  if(!dir.stat.isDirectory())throw new Error('unsafe_path');
  let directoryCount=0;
  for(const name of readdirSync(dir.target).sort()){
   const candidate=lstatSync(join(dir.target,name));
   if(candidate.isSymbolicLink())throw new Error('unsafe_path');
   if(!candidate.isDirectory()){report.excluded_count++;continue;}
   if(!idPattern.test(name)||name.length>128)throw new Error('unsafe_path');
   const relative='.ai-workflow/issues/'+name,folder=safeStat(root,relative);
   if(!folder?.stat.isDirectory()){report.excluded_count++;continue;}
   if(++directoryCount>limits.directories)throw new Error('size_limit');
   const group={id:name,entries:[]};
   const names=readdirSync(folder.target);report.excluded_count+=names.filter(n=>!kinds.some(k=>n===k+'.yaml')).length;
   for(const kind of kinds){
    const path=relative+'/'+kind+'.yaml',file=safeStat(root,path);if(!file)continue;
    if(!file.stat.isFile())throw new Error('unsafe_path');
    if(++report.artifact_count>limits.artifacts)throw new Error('size_limit');charge(path,file.stat);
    const result={path,kind,schema:'block',identity:'not_evaluated',references:'not_evaluated'};
    report.artifacts.push(result);let value;
    try{value=parseYaml(readFileSync(file.target,'utf8'));}catch{add('yaml_invalid',path);continue;}
    const validator=validators[kind];
    if(!validator(value)){add('schema_invalid',path);continue;}
    result.schema='pass';group.entries.push({kind,path,value,result});
   }
   for(const entry of group.entries)inspect(entry,group);
  }
 }catch(error){add(['unsafe_path','size_limit'].includes(error.message)?error.message:'inspection_failed');}
 return report;
}
export function serializeReport(report){
 const text=JSON.stringify(report)+'\n';
 return Buffer.byteLength(text)<=limits.reportBytes?text:JSON.stringify({format_version:1,status:'blocked',artifact_count:report.artifact_count??0,diagnostics:[{code:'output_limit',path:'',location:'',severity:'block'}]})+'\n';
}
export function main(args=process.argv.slice(2)){
 const report=args.length>1||(args.length===1&&args[0]!=='--json')?{format_version:1,status:'blocked',diagnostics:[{code:'arguments_invalid'}]}:validateRepository(process.cwd());
 const text=serializeReport(report),bounded=JSON.parse(text);
 if(args.includes('--json'))process.stdout.write(text);
 else{
  process.stdout.write(messages[bounded.status]+'\n');
  process.stdout.write('artifacts='+String(bounded.artifact_count??0)+' not_evaluated='+String(bounded.reference_counts?.not_evaluated??0)+' excluded='+String(bounded.excluded_count??0)+'\n');
  for(const d of bounded.diagnostics)process.stdout.write(d.code+(d.path?' '+d.path:'')+(d.location?' '+d.location:'')+' '+messages[d.code]+'\n');
 }
 return bounded.status==='pass'?0:1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=main();
