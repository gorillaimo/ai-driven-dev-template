import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { parseYaml } from '../workflow-rules/load.mjs';
import { adapterNames, validateForbidden, validateNormalization } from './compare.mjs';
export const limits=Object.freeze({fileBytes:1048576,caseBytes:5242880,caseFiles:128,cases:100,reportBytes:1048576,depth:12});
export const requiredCases=Object.freeze([
 'low-docs',
 'medium-feature',
 'medium-bugfix',
 'high-approval',
 'high-infra',
 'brownfield-intake',
 'safe-resume',
 'missing-ac-test',
 'implementation-before-tests',
 'always-on-conflict',
 'forbidden-output',
 'project-single-feature',
 'project-dependency-wait',
 'project-dag-cycle',
 'project-unknown-feature',
 'project-area-serialization',
 'project-member-inactive',
 'project-permission-denied',
 'project-capacity-full',
 'project-team-mismatch',
 'project-claim-request-a',
 'project-claim-request-b',
 'project-claim-owner-confirmed',
 'project-double-claim',
 'project-stale-claim',
 'project-events-first',
 'project-events-replay',
 'project-state-mismatch',
 'project-manual-fallback-paused',
 'project-manual-fallback-ready',
 'project-unassigned-no-claim',
 'project-bot-owner-missing',
 'project-issues-only',
 'project-managed-resume',
 'project-approval-wait',
 'project-partial-inventory',
]);
const mandatoryAdapters={
 'low-docs':['rules','plan','workflow'],'medium-feature':['rules','plan','workflow'],'medium-bugfix':['rules','plan','workflow'],
 'high-approval':['workflow'],'high-infra':['rules','workflow'],'brownfield-intake':['brownfield','workflow'],'safe-resume':['workflow'],
 'missing-ac-test':['trace'],'implementation-before-tests':['workflow'],'always-on-conflict':['rules'],'forbidden-output':['workflow','trace'],
 'project-single-feature':['project_plan','project_members','project_aggregate','project_recommend'],
 'project-dependency-wait':['project_plan','project_aggregate','project_recommend'],
 'project-dag-cycle':['project_plan','project_aggregate','project_recommend'],
 'project-unknown-feature':['project_plan','project_aggregate','project_recommend'],
 'project-area-serialization':['project_plan','project_aggregate','project_recommend'],
 'project-member-inactive':['project_members','project_recommend'],
 'project-permission-denied':['project_members','project_recommend'],
 'project-capacity-full':['project_members','project_aggregate','project_recommend'],
 'project-team-mismatch':['project_members','project_recommend'],
 'project-claim-request-a':['project_members','project_aggregate','project_recommend'],
 'project-claim-request-b':['project_members','project_aggregate','project_recommend'],
 'project-claim-owner-confirmed':['project_members','project_aggregate','project_recommend'],
 'project-double-claim':['project_aggregate','project_recommend'],
 'project-stale-claim':['project_aggregate','project_recommend'],
 'project-events-first':['project_aggregate','project_recommend'],
 'project-events-replay':['project_aggregate','project_recommend'],
 'project-state-mismatch':['project_aggregate','project_recommend'],
 'project-manual-fallback-paused':['project_plan','project_members','project_aggregate','project_recommend'],
 'project-manual-fallback-ready':['project_plan','project_members','project_aggregate','project_recommend'],
 'project-unassigned-no-claim':['project_members','project_aggregate','project_recommend'],
 'project-bot-owner-missing':['project_members','project_recommend'],
 'project-issues-only':['project_plan','project_members','project_aggregate','project_recommend'],
 'project-managed-resume':['project_plan','project_members','project_aggregate','project_recommend'],
 'project-approval-wait':['project_plan','project_members','project_aggregate','project_recommend'],
 'project-partial-inventory':['project_members','project_aggregate','project_recommend'],
};
const idPattern=/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function keys(value,required,optional=[]){
 if(!isObject(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))throw new Error('manifest_invalid');
}
function baseDirectory(dir){if(lstatSync(dir).isSymbolicLink()||!lstatSync(dir).isDirectory())throw new Error('unsafe_path');return realpathSync(dir);}
function scan(dir,maxFiles,maxBytes,maxDepth){
 const files=new Map();let bytes=0,count=0;
 function walk(folder,depth){
  if(depth>maxDepth)throw new Error('depth_limit');
  for(const entry of readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
   if(!/^[A-Za-z0-9_.-]+$/.test(entry.name))throw new Error('unsafe_path');
   const path=join(folder,entry.name),stat=lstatSync(path);
   if(stat.isSymbolicLink())throw new Error('unsafe_path');
   if(stat.isDirectory()){walk(path,depth+1);continue;}
   if(!stat.isFile())throw new Error('invalid_file');
   count++;bytes+=stat.size;if(stat.size>limits.fileBytes||bytes>maxBytes||count>maxFiles)throw new Error('size_limit');
   files.set(path.slice(dir.length+1).split('\\').join('/'),path);
  }
 }walk(dir,0);return files;
}
function relativePath(path){if(typeof path!=='string'||!/^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path))throw new Error('unsafe_path');return path;}
function read(files,path){relativePath(path);if(!files.has(path))throw new Error('file_missing');return parseYaml(readFileSync(files.get(path),'utf8'));}
export function loadCase(directory,id){
 const dir=baseDirectory(directory),files=scan(dir,limits.caseFiles,limits.caseBytes,limits.depth);
 const m=read(files,'case.yaml');keys(m,['format_version','id','purpose','adapters','inputs','expected','signals','normalize'],['assets']);
 if(m.format_version!==1||m.id!==id||typeof m.id!=='string'||!idPattern.test(m.id)||m.id.length>64||typeof m.purpose!=='string'||!m.purpose.trim()||m.purpose.length>1000||
  !Array.isArray(m.adapters)||!m.adapters.length||new Set(m.adapters).size!==m.adapters.length||m.adapters.some(a=>!adapterNames.includes(a)))throw new Error('manifest_invalid');
 if((mandatoryAdapters[id]??[]).some(a=>!m.adapters.includes(a)))throw new Error('mechanism_missing');
 validateNormalization(m.normalize);keys(m.inputs,m.adapters);keys(m.expected,m.adapters);keys(m.signals,m.adapters);
 const used=new Set(['case.yaml','forbidden.yaml']),inputs={},expected={};
 for(const adapter of m.adapters){
  for(const [kind,target] of [['inputs',inputs],['expected',expected]]){
   const path=m[kind][adapter];relativePath(path);
   if(!path.startsWith(kind==='inputs'?'input/':'expected/'))throw new Error('unsafe_path');
   used.add(path);target[adapter]=read(files,path);
  }
  const signal=m.signals[adapter];keys(signal,['status','codes']);
  if(!['pass','blocked','warn'].includes(signal.status)||!Array.isArray(signal.codes)||signal.codes.some(c=>typeof c!=='string'||!/^[a-z][a-z0-9_]*$/.test(c))||new Set(signal.codes).size!==signal.codes.length)throw new Error('manifest_invalid');
 }
 if(m.assets!==undefined){
  if(!Array.isArray(m.assets)||new Set(m.assets).size!==m.assets.length)throw new Error('manifest_invalid');
  for(const path of m.assets){relativePath(path);if(!path.startsWith('input/')||!files.has(path))throw new Error('file_missing');used.add(path);}
 }
 if([...files.keys()].some(p=>!used.has(p)))throw new Error('file_unregistered');
 const forbidden=read(files,'forbidden.yaml');keys(forbidden,['format_version','rules']);if(forbidden.format_version!==1)throw new Error('forbidden_invalid');validateForbidden(forbidden.rules);
 if(forbidden.rules.some(r=>!m.adapters.includes(r.adapter)))throw new Error('forbidden_adapter_missing');
 return {manifest:m,inputs,expected,forbidden:forbidden.rules};
}
export function loadSuite(directory){
 const dir=baseDirectory(directory),indexPath=join(dir,'cases.json'),stat=lstatSync(indexPath);
 if(stat.isSymbolicLink()||!stat.isFile()||stat.size>limits.fileBytes)throw new Error('invalid_file');
 const index=parseYaml(readFileSync(indexPath,'utf8'));keys(index,['format_version','cases']);
 if(index.format_version!==1||!Array.isArray(index.cases)||!index.cases.length||index.cases.length>limits.cases||new Set(index.cases).size!==index.cases.length||index.cases.some(id=>typeof id!=='string'||!idPattern.test(id)||id.length>64)||requiredCases.some(id=>!index.cases.includes(id)))throw new Error('suite_invalid');
 const declared=new Set(['cases.json',...index.cases]);
 if(readdirSync(dir).some(p=>!declared.has(p)))throw new Error('case_unregistered');
 return index.cases.map(id=>{
  try{return loadCase(join(dir,id),id);}
  catch(error){const failure=new Error('fixture_invalid');failure.case_id=id;throw failure;}
 });
}
