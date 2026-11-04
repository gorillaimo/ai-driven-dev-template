import {mkdirSync,readFileSync,writeFileSync,statSync,lstatSync,realpathSync,openSync,readSync,closeSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {executeProcess} from './process.mjs';
import {catalog,hash,same} from './core.mjs';
import {inspectJson} from './limits.mjs';
import {buildRequest} from './commands.mjs';
import {planSecurityChecks} from './plan.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeAbsolute=p=>typeof p==='string'&&/^\/[A-Za-z0-9_./-]+$/.test(p)&&!p.split('/').some(x=>x==='..'||x==='.');
export function runLabel(){const id=process.env.GITHUB_RUN_ID,attempt=process.env.GITHUB_RUN_ATTEMPT;if(/^[0-9]+$/.test(id??'')&&/^[0-9]+$/.test(attempt??''))return id+'-'+attempt;return 'local-'+process.pid;}
export function dockerCreateArgs(request,paths,operationId){
 if(!Object.values(paths).every(safeAbsolute)||!/^scan-[a-z0-9-]+$/.test(operationId))throw Error('path_invalid');
 const uid=process.getuid?.()||65532,gid=process.getgid?.()||65532;
 const args=['create','--name',operationId,'--label','ai-workflow-operation='+operationId,'--label','ai-workflow-run='+runLabel(),'--network','none','--read-only','--user',uid+':'+gid,'--cap-drop=ALL','--security-opt=no-new-privileges','--memory='+request.limits.memory_mib+'m','--cpus='+request.limits.cpus,'--pids-limit='+request.limits.pids,'--tmpfs','/tmp:rw,noexec,nosuid,size=64m,mode=1777','--tmpfs','/out:rw,noexec,nosuid,size=12m,mode=1777'];
 for(const [src,dst]of [[paths.view,'/src'],[paths.bin,'/tools'],[paths.db,'/db/osv-scalibr'],[paths.rules,'/policy'],[paths.controller,'/controller/worker.py'],[paths.config,'/controller/config.json']])args.push('--mount','type=bind,src='+src+',dst='+dst+',readonly');
 args.push('--entrypoint','python3',request.image,'/controller/worker.py');return args;
}
function safeFile(rootPath,path,maxSize=10*1024*1024){
 if(!/^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path))throw Error('path_invalid');
 let p=realpathSync(rootPath);for(const part of path.split('/')){p=join(p,part);if(lstatSync(p).isSymbolicLink())throw Error('path_invalid');}if(!statSync(p).isFile()||statSync(p).size>maxSize)throw Error('file_invalid');return p;
}
function fileHash(path){const h=createHash('sha256'),fd=openSync(path,'r'),buffer=Buffer.alloc(1024*1024);try{let n;while((n=readSync(fd,buffer,0,buffer.length,null)))h.update(buffer.subarray(0,n));return h.digest('hex');}finally{closeSync(fd);}}
export function createDockerExecutor({toolRoot,sourceRoot,outputRoot,signal},driver=executeProcess){
 const toolPath=realpathSync(toolRoot),sourcePath=realpathSync(sourceRoot),outPath=realpathSync(outputRoot);
 const env={...process.env};for(const k of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[k];
 const docker=(args,options={})=>driver('docker',['--host=unix:///var/run/docker.sock',...args],{env,...options});
 let uncertain=false,active=0;
 return {async execute(request){
  if(inspectJson(request)||!request?.limits||active>=request.limits.max_concurrent)throw Error('capacity_invalid');
  active++;try{
  if(inspectJson(request)||!same(request.check,request.plan.checks.find(c=>c.check_id===request.check.check_id))||!same(planSecurityChecks(request.plan.inputs),request.plan)||!same(buildRequest({plan:request.plan,check:request.check,workspace:request.workspace,outputDir:request.outputDir}),request))throw Error('executor_request_invalid');
  if(signal?.aborted||uncertain||realpathSync(request.workspace)!==sourcePath||realpathSync(request.outputDir)!==outPath||request.image!==catalog.image)throw Error('executor_scope_invalid');
  const inventory=JSON.parse(readFileSync(join(toolPath,'inventory.json'),'utf8'));
  if(hash(inventory)!==hash(request.plan.inputs.context.inventory))throw Error('inventory_changed');
  for(const [file,digest]of Object.entries(catalog.rules))if(sha(readFileSync(new URL('./rules/'+file,import.meta.url)))!==digest)throw Error('rules_changed');
  if(request.tool_id!=='semgrep'){const t=catalog.tools.find(t=>t.tool_id===request.tool_id),record=inventory.tools.find(t=>t.tool_id===request.tool_id);if(fileHash(safeFile(join(toolPath,'bin'),t.binary,256*1024*1024))!==record.binary_digest)throw Error('binary_changed');}
  const image=await docker(['image','inspect',catalog.image,'--format','{{json .RepoDigests}}']);if(image.error||image.code!==0||!JSON.parse(image.stdout).includes(catalog.image))throw Error('image_missing');
  const operationId='scan-'+randomUUID(),operation=join(outPath,operationId);mkdirSync(operation,{mode:0o700});const view=join(operation,'source');mkdirSync(view,{mode:0o755});
  for(const path of request.check.targets){const original=safeFile(sourcePath,path),data=readFileSync(original),target=request.plan.inputs.context.targets.find(t=>t.path===path);if(!target||sha(data)!==target.digest)throw Error('source_changed');const destination=join(view,path);mkdirSync(dirname(destination),{recursive:true,mode:0o755});writeFileSync(destination,data,{mode:0o444,flag:'wx'});}
  // Ignore files from the repository are data, never authority to suppress a scan.
  if(request.tool_id==='semgrep')writeFileSync(join(view,'.semgrepignore'),'',{mode:0o444});
  for(const database of request.plan.inputs.context.inventory.databases){const path=safeFile(join(toolPath,'db'),database.ecosystem+'/all.zip',1024*1024*1024);if(fileHash(path)!==database.digest)throw Error('database_changed');}
  const config=join(operation,'config.json');writeFileSync(config,JSON.stringify({operation_id:operationId,tool_id:request.tool_id,entrypoint:request.entrypoint,argv:request.argv,version:request.version,target_count:request.check.targets.length,timeout_seconds:request.limits.timeout_seconds,max_raw_bytes:request.limits.max_raw_bytes}),{mode:0o444});
  const paths={view,bin:join(toolPath,'bin'),db:join(toolPath,'db'),rules:join(root,'rules'),controller:join(root,'worker.py'),config};let created=false,response;
  try{
   const create=await docker(dockerCreateArgs(request,paths,operationId));if(create.error||create.code!==0)throw Error('container_create_failed');created=true;
   const inspect=await docker(['inspect',operationId]);if(inspect.error||inspect.code!==0)throw Error('container_inspect_failed');const details=JSON.parse(inspect.stdout)[0];
   if(details.HostConfig.NetworkMode!=='none'||!details.HostConfig.ReadonlyRootfs||details.Config.User==='0:0'||details.Mounts.some(m=>m.RW)||details.HostConfig.Memory!==request.limits.memory_mib*1024*1024||details.HostConfig.PidsLimit!==request.limits.pids||details.HostConfig.NanoCpus!==request.limits.cpus*1e9)throw Error('container_boundary_invalid');
   if(signal?.aborted)throw Error('cancelled');
   response=await docker(['start','--attach',operationId],{timeoutMs:(request.limits.timeout_seconds+45)*1000,maxBytes:24*1024*1024,signal});
  }finally{
   // Also reconcile create's ambiguous response: do not assume a failed client means no container.
   const stop=await docker(['rm','--force',operationId],{timeoutMs:15000});
   const remains=await docker(['ps','--all','--quiet','--filter','name=^/'+operationId+'$'],{timeoutMs:10000});
   if(remains.error||remains.code!==0||remains.stdout.trim()){uncertain=true;throw Error('stopped_unknown');}
  }
  if(!response||response.error||response.code!==0||response.timedOut||response.limited)throw Error('worker_failed');
  const parsed=JSON.parse(response.stdout);if(typeof parsed.rawResult!=='string'||Buffer.byteLength(parsed.rawResult)>request.limits.max_raw_bytes)throw Error('output_limit');
  writeFileSync(join(operation,'raw.json'),parsed.rawResult,{mode:0o600,flag:'wx'});
  if(parsed.private_debug){writeFileSync(join(operation,'private-debug.json'),JSON.stringify(parsed.private_debug),{mode:0o600,flag:'wx'});delete parsed.private_debug;}
  return parsed;
  }finally{active--;}
 }};
}
