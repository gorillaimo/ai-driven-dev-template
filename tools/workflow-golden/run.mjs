import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { adapterNames, compareSnapshot, checkForbidden } from './compare.mjs';
import { loadSuite, limits } from './load.mjs';
import { evaluate } from './adapters.mjs';
import { messages } from './messages.mjs';
export function runCase(c){
 const {manifest:m}=c,outputs={},findings=[],adapters=[];
 for(const adapter of adapterNames){
  if(!m.adapters.includes(adapter)){adapters.push({adapter,status:'not_evaluated'});continue;}
  const count=findings.length;
  try{
   const before=structuredClone(c.inputs[adapter]);outputs[adapter]=evaluate(adapter,c.inputs[adapter]);
   if(!isDeepStrictEqual(before,c.inputs[adapter]))findings.push({code:'input_mutated',adapter});
   for(const path of compareSnapshot(outputs[adapter],c.expected[adapter],m.normalize))findings.push({code:'snapshot_mismatch',adapter,path});
   const out=outputs[adapter],status=adapter==='plan'?'pass':out.status,codes=[...new Set((out.diagnostics??[]).map(d=>d.code))].sort();
   if(status!==m.signals[adapter].status||!isDeepStrictEqual(codes,[...m.signals[adapter].codes].sort()))findings.push({code:'signal_mismatch',adapter});
  }catch{findings.push({code:'adapter_failed',adapter});}
  adapters.push({adapter,status:findings.length===count?'passed':'failed'});
 }
 try{
  for(const f of checkForbidden(outputs,c.forbidden)){findings.push(f);const a=adapters.find(a=>a.adapter===f.adapter);if(a)a.status='failed';}
 }catch{findings.push({code:'adapter_failed'});}
 return {id:m.id,status:findings.length?'failed':'passed',adapters,findings};
}
export function runSuite(suite){const cases=suite.map(runCase);return {format_version:1,status:cases.length&&cases.every(c=>c.status==='passed')?'passed':'failed',cases};}
export function serializeReport(report){
 const text=JSON.stringify(report)+'\n';
 return Buffer.byteLength(text)<=limits.reportBytes?text:JSON.stringify({format_version:1,status:'failed',cases:[],findings:[{code:'output_limit'}]})+'\n';
}
export function main(args=process.argv.slice(2)){
 let report;
 if(args.length>1||(args.length===1&&args[0]!=='--json'))report={format_version:1,status:'failed',cases:[],findings:[{code:'arguments_invalid'}]};
 else try{report=runSuite(loadSuite(fileURLToPath(new URL('../../tests/workflow-golden/fixtures/',import.meta.url))));}
 catch(error){report={format_version:1,status:'failed',cases:[],findings:[{code:'fixture_invalid',...(error.case_id?{case_id:error.case_id}:{})}]};}
 const serialized=serializeReport(report),bounded=JSON.parse(serialized);
 if(args.includes('--json'))process.stdout.write(serialized);
 else{
  process.stdout.write(messages[bounded.status]+'\n');
  for(const c of bounded.cases)process.stdout.write(c.id+': '+c.status+'\n');
  for(const c of bounded.cases)for(const f of c.findings)process.stdout.write(c.id+' '+f.code+(f.adapter?' '+f.adapter:'')+(f.path?' '+f.path:'')+(Number.isInteger(f.rule)?' #'+f.rule:'')+'\n');
  for(const f of bounded.findings??[])process.stdout.write((f.case_id?f.case_id+' ':'')+f.code+' '+messages[f.code]+'\n');
 }
 return bounded.status==='passed'?0:1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=main();
