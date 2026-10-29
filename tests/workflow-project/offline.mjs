import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns';
import child from 'node:child_process';
const denied=()=>{throw Error('external_operation_forbidden');};
for(const [module,keys] of [[http,['request','get']],[https,['request','get']],[net,['connect','createConnection']],[dns,['lookup','resolve']],[child,['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']]])for(const key of keys)module[key]=denied;
globalThis.fetch=denied;syncBuiltinESMExports();
