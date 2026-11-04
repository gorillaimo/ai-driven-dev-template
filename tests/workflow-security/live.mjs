// Explicit live trial only: generated inert fixtures, real pinned tools, no production target.
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';
import {executeProcess} from '../../tools/workflow-security/process.mjs';
import {planSecurityChecks} from '../../tools/workflow-security/plan.mjs';
import {runSecurityCheck} from '../../tools/workflow-security/run.mjs';
import {createDockerExecutor} from '../../tools/workflow-security/docker.mjs';
import {scannerFixture,refresh} from './fixture.mjs';
const toolRoot=process.argv[2];if(!toolRoot){console.error('usage: live.mjs <acquired-tool-directory>');process.exit(2);}
const work=mkdtempSync(join(tmpdir(),'workflow-security-live-')),bin=join(work,'tools');mkdirSync(bin,{mode:0o755});cpSync(join(toolRoot,'bin'),join(bin,'bin'),{recursive:true});mkdirSync(join(bin,'db/npm'),{recursive:true,mode:0o755});
const zip=await executeProcess('python3',['-c',`import json,zipfile,sys
v=json.load(open(sys.argv[2]))
with zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr(v['id']+'.json',json.dumps(v))`,join(bin,'db/npm/all.zip'),fileURLToPath(new URL('./fixtures/osv-advisory.json',import.meta.url))]);if(zip.code!==0)throw Error('synthetic_database_failed');
const sha=b=>createHash('sha256').update(b).digest('hex');const inventory=JSON.parse(readFileSync(join(toolRoot,'inventory.json')));const now=new Date().toISOString();inventory.databases=[{ecosystem:'npm',digest:sha(readFileSync(join(bin,'db/npm/all.zip'))),fetched_at:now,checked_at:now,source:'urn:ai-workflow:synthetic-osv-db',snapshot_kind:'synthetic_fixture'}];writeFileSync(join(bin,'inventory.json'),JSON.stringify(inventory),{mode:0o600});
const outcomes=[];
for(const toolId of (process.env.SECURITY_LIVE_TOOL?[process.env.SECURITY_LIVE_TOOL]:['gitleaks','osv','semgrep','trivy']))for(const detected of [false,true]){
 const dir=join(work,toolId+'-'+detected),src=join(dir,'source'),out=join(dir,'output');mkdirSync(src,{recursive:true,mode:0o755});mkdirSync(out,{mode:0o700});
 let path='src/index.js',data=detected?(toolId==='gitleaks'?'const api_key = "'+['AK','IA','Q7M8R2P3V4X5Y6Z9'].join('')+'";\n':'eval(input);\n'):'export const answer = 42;\n';
 if(toolId==='osv'){path='package-lock.json';data=JSON.stringify({name:'synthetic-application',version:'1.0.0',lockfileVersion:3,requires:true,packages:{'':{name:'synthetic-application',version:'1.0.0',dependencies:{'ansi-html':detected?'0.0.7':'0.0.8'}},'node_modules/ansi-html':{version:detected?'0.0.7':'0.0.8',resolved:'https://registry.npmjs.org/ansi-html/-/ansi-html-'+(detected?'0.0.7':'0.0.8')+'.tgz'}}});}
 if(toolId==='trivy'){path='Dockerfile';data=detected?'FROM alpine:3.20\nUSER root\n':'FROM alpine:3.20.3\nWORKDIR /app\nCOPY --chown=65532:65532 . .\nUSER 65532:65532\nHEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD ["true"]\nCMD ["true"]\n';}
 mkdirSync(join(src,'src'),{recursive:true,mode:0o755});writeFileSync(join(src,path),data,{mode:0o444});
 const s=scannerFixture(toolId);s.context.evaluated_at=new Date().toISOString();s.profile.reviewed_at=s.context.evaluated_at;s.profile.expires_at=new Date(Date.now()+3600000).toISOString();s.context.facts.forEach(f=>f.observed_at=s.context.evaluated_at);s.context.inventory=inventory;s.context.targets[0].digest=sha(Buffer.from(data));refresh(s);const plan=planSecurityChecks(s);
 if(plan.status!=='pass'){outcomes.push({tool_id:toolId,case:detected?'detection':'clean',status:'plan_blocked',codes:plan.diagnostics.map(d=>d.code)});continue;}
 const result=await runSecurityCheck({plan,checkId:'secrets',workspace:src,outputDir:out},createDockerExecutor({toolRoot:bin,sourceRoot:src,outputRoot:out}));
 writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2),{mode:0o600});outcomes.push({tool_id:toolId,case:detected?'detection':'clean',status:result.status,finding_count:result.findings?.length??0,codes:result.diagnostics?.map(d=>d.code),expected:detected?'failed':'passed'});
}
const result={fixture_kind:'synthetic',actual_tools:true,vulnerability_intelligence:'synthetic_fixture',outcomes};writeFileSync(join(work,'summary.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({...result,protected_details:work}));process.exitCode=outcomes.some(x=>x.status!==x.expected)?1:0;
