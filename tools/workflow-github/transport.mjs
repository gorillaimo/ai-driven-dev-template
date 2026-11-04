import {spawn}from'node:child_process';
import {readFileSync,lstatSync,realpathSync}from'node:fs';
import {relative,sep}from'node:path';
import {fileURLToPath}from'node:url';
import {createPrivateKey,sign}from'node:crypto';
import {badJson,PERMISSIONS,same,nowValid,fail,errorCode,safeError}from'./core.mjs';
import {API_VERSION,boundedCall}from'./client.mjs';
const sessions=new WeakMap(),sourceRoot=realpathSync(new URL('../../',import.meta.url));
export function privateHttpRequest(request){
  return new Promise((resolve,reject)=>{
    let child,stdout=[],size=0,settled=false,timer;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);request.signal?.removeEventListener('abort',stop);if(error)reject(safeError('http_transport_failed'));else resolve(value);};
    const stop=()=>{child?.kill('SIGKILL');finish(true);};
    try{
      if(request.signal?.aborted){finish(true);return;}
      // Credentials travel only through this controller-owned pipe, never argv or logs.
      child=spawn('python3',[fileURLToPath(new URL('./http.py',import.meta.url))],{shell:false,env:process.env,stdio:['pipe','pipe','pipe']});
      timer=setTimeout(stop,11000);request.signal?.addEventListener('abort',stop,{once:true});
      child.stdout.on('data',chunk=>{size+=chunk.length;if(size>3*1024*1024){stop();return;}stdout.push(chunk);});child.stderr.on('data',()=>{});
      child.on('error',()=>finish(true));child.stdin.on('error',()=>finish(true));
      child.on('close',code=>{if(code!==0){finish(true);return;}try{const value=JSON.parse(Buffer.concat(stdout).toString('utf8'));if(badJson(value)||!Number.isInteger(value.status)||value.error)throw Error();finish(false,value);}catch{finish(true);}});
      const{method,path,headers,body,token}=request;child.stdin.end(JSON.stringify({method,path,headers,...(body===undefined?{}:{body}),...(token===undefined?{}:{token})}));
    }catch{stop();}
  });
}
function route(repository,method,path){
  if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||path.includes('\\')||/[\x00-\x20#]/.test(path)||/%(?:2f|5c|2e)/i.test(path))return false;
  const url=new URL(path,'https://api.github.com'),prefix='/repos/'+repository,local=url.pathname.slice(prefix.length);
  if(!url.pathname.startsWith(prefix)||local!==''&&!local.startsWith('/'))return false;
  if(method==='GET')return local===''||/^\/(?:issues(?:\/\d+(?:\/comments)?)?|pulls(?:\/\d+(?:\/reviews(?:\/\d+)?)?)?|branches(?:\/[A-Za-z0-9_./-]+(?:\/protection)?)?|collaborators\/[A-Za-z0-9-]+\/permission|rulesets(?:\/\d+)?|rules\/branches\/[A-Za-z0-9_./-]+|git\/(?:ref\/heads\/[A-Za-z0-9_./-]+|commits\/[a-f0-9]{40}|trees\/[a-f0-9]{40}|blobs\/[a-f0-9]{40}))$/.test(local);
  if(method==='POST')return /^\/(?:git\/(?:refs|blobs|trees|commits)|issues\/\d+\/comments|pulls)$/.test(local);
  if(method==='PATCH')return /^\/(?:git\/refs\/heads\/ai-work\/[1-9][0-9]*\/[a-z0-9_-]+|pulls\/\d+)$/.test(local);
  return false;
}
export function createRestTransport({repository,repositoryId,mode='read_only',session,clock=()=>new Date().toISOString()},driver=privateHttpRequest){
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)||!Number.isSafeInteger(repositoryId)||repositoryId<1||!['read_only','broker'].includes(mode)||mode==='broker'&&!sessions.has(session))fail('transport_configuration_invalid');
  function current(){const state=sessions.get(session);if(state&&(state.revoked||!nowValid(clock())||Date.parse(state.metadata.expires_at)<=Date.parse(clock())||state.repository!==repository||!same(state.metadata.repository_ids,[repositoryId])))fail('credential_expired');return state;}
  return Object.freeze({kind:session?'github_app':'public_read_only',async identity(){const state=current();if(!state)fail('credential_missing');return structuredClone(state.metadata);},async request(value){
    const{method,path,body,signal}=value;
    if(!route(repository,method,path)||mode==='read_only'&&method!=='GET')fail('endpoint_denied');
    const headers={'X-GitHub-Api-Version':API_VERSION,Accept:'application/vnd.github+json'};
    for(const[k,v]of Object.entries(value.headers??{})){if(!['accept','x-github-api-version','if-none-match'].includes(k.toLowerCase())||typeof v!=='string'||/[\r\n]/.test(v))fail('header_invalid');if(k.toLowerCase()==='if-none-match')headers['If-None-Match']=v;}
    const state=current();if(method!=='GET'&&!state)fail('credential_missing');
    try{return await boundedCall(s=>driver({method,path,headers,...(body===undefined?{}:{body}),...(state?{token:state.token}:{}),signal:s}),10000,signal);}catch(error){throw safeError(errorCode(error,'http_transport_failed'));}
  }});
}
export function createGitHubAppTokenProvider(config,driver=privateHttpRequest){
  // Merely constructing this object reads no key and makes no API request.
  let issuing=false;const owned=new Set();
  async function call(method,path,token,body){const r=await boundedCall(signal=>driver({method,path,headers:{'X-GitHub-Api-Version':API_VERSION,Accept:'application/vnd.github+json'},token,...(body===undefined?{}:{body}),signal}),10000);if(badJson(r)||!r||r.status<200||r.status>=300)fail('app_response_invalid');return r.body;}
  return Object.freeze({async issue(){
    let token;try{
      if(config?.enabled!==true||issuing||!Number.isSafeInteger(config.appId)||config.appId<1||!Number.isSafeInteger(config.installationId)||config.installationId<1||!Number.isSafeInteger(config.repositoryId)||config.repositoryId<1||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository)||typeof config.clock!=='function')fail('app_configuration_required');issuing=true;
      const path=realpathSync(config.privateKeyPath),rel=relative(sourceRoot,path),stat=lstatSync(config.privateKeyPath);if(stat.isSymbolicLink()||!stat.isFile()||(stat.mode&0o077)||stat.size>16384||!(rel==='..'||rel.startsWith('..'+sep)))fail('app_key_invalid');
      const key=createPrivateKey(readFileSync(path));if(key.asymmetricKeyType!=='rsa')fail('app_key_invalid');
      const now=config.clock();if(!nowValid(now))fail('time_invalid');const seconds=Math.floor(Date.parse(now)/1000),encoded=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),base=encoded({alg:'RS256',typ:'JWT'})+'.'+encoded({iat:seconds-60,exp:seconds+540,iss:String(config.appId)}),jwt=base+'.'+sign('RSA-SHA256',Buffer.from(base),key).toString('base64url');
      const app=await call('GET','/app',jwt),installation=await call('GET','/app/installations/'+config.installationId,jwt);
      if(app.id!==config.appId||typeof app.slug!=='string'||!/^[a-z0-9-]+$/.test(app.slug)||installation.id!==config.installationId||installation.app_id!==config.appId||installation.suspended_at!==null)fail('app_identity_invalid');
      const issued=await call('POST','/app/installations/'+config.installationId+'/access_tokens',jwt,{repository_ids:[config.repositoryId],permissions:{...PERMISSIONS}});token=issued.token;
      if(typeof token!=='string'||!/^[A-Za-z0-9_.-]{1,16384}$/.test(token)||!same(issued.permissions,PERMISSIONS)||!nowValid(issued.expires_at)||Date.parse(issued.expires_at)<=Date.parse(config.clock())||Date.parse(issued.expires_at)-Date.parse(now)>3600000+60000)fail('app_scope_invalid');
      const repos=await call('GET','/installation/repositories',token),bot=await call('GET','/users/'+encodeURIComponent(app.slug+'[bot]'),token);
      if(repos.total_count!==1||!Array.isArray(repos.repositories)||repos.repositories.length!==1||repos.repositories[0].id!==config.repositoryId||repos.repositories[0].full_name!==config.repository||bot.type!=='Bot'||bot.login!==app.slug+'[bot]'||!Number.isSafeInteger(bot.id)||bot.id<1)fail('app_scope_invalid');
      const session=Object.freeze({});sessions.set(session,{repository:config.repository,token,revoked:false,metadata:{kind:'github_app',repository_ids:[config.repositoryId],app_id:config.appId,actor_id:bot.id,permissions:{...PERMISSIONS},expires_at:issued.expires_at}});owned.add(session);return session;
    }catch(error){if(token){try{await call('DELETE','/installation/token',token);}catch{}}throw safeError(errorCode(error,'app_token_failed'));}finally{issuing=false;}
  },async revoke(session){const state=sessions.get(session);if(!owned.has(session)||!state||state.revoked)fail('app_session_invalid');try{await call('DELETE','/installation/token',state.token);state.revoked=true;state.token='';}catch{fail('token_revocation_unknown');}}});
}
