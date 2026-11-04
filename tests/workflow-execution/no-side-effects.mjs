// Run in a fresh process: any attempted external operation or write is a test failure.
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import dgram from 'node:dgram';
import cp from 'node:child_process';
import { loadExecutionEvidence } from '../../tools/workflow-execution/load.mjs';
import { checkExecutionEvidence } from '../../tools/workflow-execution/check.mjs';
const deny=()=>{throw Error('external_operation_forbidden');};
for(const module of [http,https,net,tls,dns,dgram,cp])for(const key of ['request','get','connect','createConnection','createSocket','lookup','resolve','exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'])if(typeof module[key]==='function')module[key]=deny;
for(const key of ['writeFile','writeFileSync','appendFile','appendFileSync','mkdir','mkdirSync','unlink','unlinkSync','rm','rmSync','rename','renameSync','symlink','symlinkSync','copyFile','copyFileSync','createWriteStream','truncate','truncateSync'])fs[key]=deny;
globalThis.fetch=deny;syncBuiltinESMExports();
const base='.ai-workflow/templates/execution/v1/';
const r=checkExecutionEvidence(loadExecutionEvidence(process.cwd(),{profile:base+'profile.yaml',grant:base+'grant.yaml',context:base+'context.yaml',verifications:[base+'verification.yaml'],reviews:[base+'review.yaml'],securityResults:[],integrationResults:[]}));
if(r.status!=='pass')throw Error('example_invalid');console.log('read_only_pass');
