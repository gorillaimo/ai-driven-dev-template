// Synthetic API, identities and signatures. This does not authenticate a real human.
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical } from '../../tools/workflow-rules/resolve.mjs';
import { fixture as execution, ref, hash, rebind, source } from '../workflow-execution/fixture.mjs';
import { createAuthorityProvider } from '../../tools/workflow-github/auth.mjs';
import { createFileJournal } from '../../tools/workflow-github/journal.mjs';
export { hash, ref };
export const time = '2026-11-04T00:10:00Z';
export const limits = { collector_seconds:60, requests:400, page_items:100, resource_items:1000, discussion_items:10000, response_bytes:2097152, raw_bytes:67108864, operation_seconds:180, operation_requests:100, file_count:32, file_bytes:1048576, change_bytes:5242880, journal_transitions:10000, journal_bytes:33554432 };
export function apiIssue() { return {id:11,number:1,state:'open',title:'Synthetic work',body:'Synthetic contract',assignees:[{id:7,login:'gorillaimo'}],labels:[{name:'ready-for-ai'}],updated_at:time}; }
export const contractDigest = i => hash({id:i.id,number:i.number,title:i.title,body:i.body,assignees:i.assignees.map(a=>({id:a.id,login:a.login})),labels:i.labels.map(a=>a.name).sort()});
export function policy(profile) { return { schema_version:1,artifact_kind:'github-policy',artifact_id:'github-policy',revision:1,repository:'example/synthetic',repository_id:1,owner:{id:7,login:'gorillaimo'},profile:ref(profile),mode:'trial',reviewed_at:'2026-11-04T00:00:00Z',expires_at:'2026-11-05T00:00:00Z',base_branch:'main',branch_prefix:'ai-work/',protected_branches:['main'],allowed_operations:['create_branch','publish_commit','append_claim','append_record','create_draft_pr','update_draft_pr'],allowed_paths:['src'],forbidden_paths:['secrets'],ttl_seconds:60,request_ttl_seconds:300,monitor_seconds:30,limits:{...limits},manual_mappings:[{id:21,body_digest:hash('policy approval'),disposition:'not_claim'},{id:22,body_digest:hash('design approval'),disposition:'not_claim'}]}; }
export function snapshot(p) {
 const i=apiIssue();
 return {schema_version:1,artifact_kind:'github-snapshot',repository:p.repository,repository_id:1,started_at:time,finished_at:time,status:'complete',policy_digest:hash(p),default_branch:'main',sections:Object.fromEntries(['issues','prs','branches','comments','reviews','permissions','protections'].map(k=>[k,'complete'])),issues:[{id:11,number:1,state:'open',assignees:i.assignees,labels:['ready-for-ai'],updated_at:time,body_digest:hash(i.body),contract_digest:contractDigest(i)}],prs:[],branches:[{name:'main',sha:'2'.repeat(40),protected:true}],sources:[{kind:'comment',id:21,issue_number:1,actor_id:7,actor_type:'User',updated_at:time,body_digest:hash('policy approval'),state:'active',machine:null},{kind:'comment',id:22,issue_number:1,actor_id:7,actor_type:'User',updated_at:time,body_digest:hash('design approval'),state:'active',machine:null}],permissions:[{actor_id:7,login:'gorillaimo',permission:'admin',observed_at:time}],protections:[{branch:'main',enforced:true,bypass_actors:[],observed_at:time,source_digest:'a'.repeat(64)}],pages:[],unresolved:[]};
}
export function fixture() {
 const e=execution();e.profile.allowed_stages=['implementation','validation','handoff'];e.grant.selected[0].stages=[...e.profile.allowed_stages];e.grant.selected[0].contract_digest=contractDigest(apiIssue());rebind(e);
 const p=policy(e.profile),snap=snapshot(p),keys=generateKeyPairSync('ed25519');
 const signed=(kind,payload)=>{const value={schema_version:1,artifact_kind:kind,issuer:'synthetic-issuer',key_id:'synthetic-key',payload};value.signature=sign(null,Buffer.from('workflow-github:v1:'+kind+'\n'+canonical({issuer:value.issuer,key_id:value.key_id,payload})),keys.privateKey).toString('base64');return value;};
 const request=signed('session-request',{event_id:'event-1',session_id:'session-1',nonce:'nonce-1',audience:'workflow-github',repository_id:1,owner_id:7,actor_id:7,run_id:e.grant.run_id,policy_digest:hash(p),profile_digest:hash(e.profile),intent:'continue',issued_at:'2026-11-04T00:09:00Z',expires_at:'2026-11-04T00:14:00Z'});
 e.grant.request.reference={kind:'source',id:'event-1',revision:1,digest:hash(request),location:{kind:'id',target:'event-1'}};e.grant.issued_at=time;
 const approvalProofs=[['policy',e.grant.policy_approval_refs[0],snap.sources[0],hash({policy:p,profile:e.profile})],['design',e.grant.selected[0].approval_refs[0],snap.sources[1],hash({issue_number:1,contract_digest:e.grant.selected[0].contract_digest,design_digest:e.grant.selected[0].design_digest,plan:e.grant.selected[0].plan,profile:e.grant.selected[0].profile})]].map(([kind,reference,src,target_digest])=>signed('approval-proof',{kind,reference,source:src,target_digest,actor_id:7,repository_id:1,issued_at:time,expires_at:'2026-11-04T06:00:00Z'}));
 const directory=mkdtempSync(join(tmpdir(),'workflow-github-journal-')),journal=createFileJournal({directory,sourceRoot:new URL('../../',import.meta.url)});
 const state={snapshot:snap,execution:{run_id:e.grant.run_id,claim_id:'claim-1',worker_id:'worker-1',generation:1,branch:'ai-work/1/branch-1',reserved:true,stopped:false,expected_head:'2'.repeat(40),expires_at:'2026-11-04T06:00:00Z'},credential:{kind:'github_app',repository_ids:[1],app_id:9,actor_id:99,permissions:{metadata:'read',contents:'write',issues:'write',pull_requests:'write',administration:'read'},expires_at:'2026-11-04T01:00:00Z'}};
 const provider=createAuthorityProvider({mode:'trial',keys:[{issuer:'synthetic-issuer',key_id:'synthetic-key',public_key:keys.publicKey.export({type:'spki',format:'pem'}),expires_at:'2026-11-05T00:00:00Z',human_attestation:true}],clock:()=>time,journal,observe:async()=>structuredClone(state)});
 const input={policy:p,profile:e.profile,grant:e.grant,snapshot:snap,request,approvalProofs};
 const operation={schema_version:1,artifact_kind:'github-operation',operation_id:'branch-1',kind:'create_branch',repository:p.repository,repository_id:1,issue_number:1,run_id:e.grant.run_id,claim_id:'claim-1',worker_id:'worker-1',generation:1,branch:'ai-work/1/branch-1',expected_head:'2'.repeat(40),policy_digest:hash(p),grant_digest:hash(e.grant),stage:'implementation',payload:{}};
 return {...input,input,state,provider,journal,directory,operation,signed,close:()=>journal.close()};
}
export function fakeApi() {
 const calls=[],refs=new Map([['main','2'.repeat(40)]]),comments=[],prs=[];
 let lose=null;
 return {calls,refs,comments,prs,loseNext(kind){lose=kind;},async request(r){calls.push(structuredClone(r));const url=new URL(r.path,'https://api.github.com'),path=url.pathname;
   const response=(body,status=200)=>({status,headers:{},body});
   if(r.method==='GET'&&path.endsWith('/git/ref/heads/ai-work/1/branch-1'))return refs.has('ai-work/1/branch-1')?response({ref:'refs/heads/ai-work/1/branch-1',object:{sha:refs.get('ai-work/1/branch-1')}}):response({},404);
   if(r.method==='POST'&&path.endsWith('/git/refs')){const name=r.body.ref.slice(11);if(refs.has(name))return response({},422);refs.set(name,r.body.sha);if(lose==='branch'){lose=null;throw Error('SECRET_CANARY');}return response({ref:r.body.ref,object:{sha:r.body.sha}},201);}
   if(r.method==='GET'&&path.endsWith('/comments'))return response(comments);
   if(r.method==='POST'&&path.endsWith('/comments')){const c={id:101,body:r.body.body,user:{id:99,type:'Bot'},updated_at:time};comments.push(c);if(lose==='comment'){lose=null;throw Error('SECRET_CANARY');}return response(c,201);}
   if(r.method==='GET'&&path.endsWith('/pulls'))return response(prs);
   if(r.method==='POST'&&path.endsWith('/pulls')){const p={number:2,id:12,draft:true,state:'open',body:r.body.body,user:{id:99,type:'Bot'},head:{ref:r.body.head,sha:refs.get(r.body.head),repo:{id:1}},base:{ref:r.body.base,sha:'2'.repeat(40),repo:{id:1}}};prs.push(p);if(lose==='pr'){lose=null;throw Error('SECRET_CANARY');}return response(p,201);}
   return response({},404);
 }};
}
