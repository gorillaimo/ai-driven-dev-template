import {mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';import{createHash}from'node:crypto';
import {executeProcess} from './process.mjs';import{catalog,formatOf}from'./core.mjs';
export async function createSnapshot({repo,head,destination,signal}){
 if(!/^[0-9a-f]{40}$/.test(head))throw Error('snapshot_invalid');const root=realpathSync(repo);
 const git=async args=>{const r=await executeProcess('git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-C',root,...args],{maxBytes:12*1024*1024,timeoutMs:30000,binary:true,signal,env:{...process.env,GIT_NO_LAZY_FETCH:'1'}});if(r.error||r.code!==0||r.limited||r.timedOut)throw Error('snapshot_invalid');return r.stdout;};
 const listing=(await git(['ls-tree','-r','-z','--full-tree',head])).toString('utf8').split('\0').filter(Boolean);if(listing.length>catalog.max_source_files)throw Error('snapshot_limit');
 mkdirSync(destination,{mode:0o755});const targets=[];let bytes=0;
 for(const row of listing){const match=/^(100644|100755) blob ([0-9a-f]{40})\t((?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)$/.exec(row);if(!match)throw Error('snapshot_invalid');const [,mode,sha,path]=match;
  if(path.split('/').some(x=>catalog.system_exclusions.includes(x)))continue;
  const data=await git(['cat-file','blob',sha]);bytes+=data.length;if(bytes>catalog.max_source_bytes||data.length>10*1024*1024)throw Error('snapshot_limit');
  const output=join(destination,path);mkdirSync(dirname(output),{recursive:true,mode:0o755});writeFileSync(output,data,{mode:0o444,flag:'wx'});
  let format=formatOf(path);if(format==='text'&&/\.(json|ya?ml)$/.test(path)){const text=data.toString('utf8');if(/(?:^|\n)(?:AWSTemplateFormatVersion|Resources):|"AWSTemplateFormatVersion"\s*:/.test(text))format='cloudformation';else if(/(?:^|\n)apiVersion:\s*\S/.test(text)&&/(?:^|\n)kind:\s*\S/.test(text))format='kubernetes';}
  targets.push({path,digest:createHash('sha256').update(data).digest('hex'),format});
 }
 if(!targets.length)throw Error('snapshot_invalid');return {head_sha:head,targets};
}
