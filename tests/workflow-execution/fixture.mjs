// Synthetic records only. These actors, approvals and results prove no live execution.
import { canonical, digest } from '../../tools/workflow-rules/resolve.mjs';
export const hash=value=>digest(canonical(value));
export const time='2026-11-04T00:10:00Z';
export const human={actor_type:'human',actor_ref:'gorillaimo'};
export const ai={actor_type:'ai_agent',actor_ref:'implementer',on_behalf_of:'gorillaimo'};
export const reviewer={actor_type:'ai_agent',actor_ref:'reviewer',on_behalf_of:'gorillaimo'};
export const source=id=>({kind:'source',id,revision:1,digest:'a'.repeat(64),location:{kind:'id',target:'protected-'+id}});
export const ref=r=>({kind:r.artifact_kind,id:r.artifact_id,revision:r.revision,digest:hash(r),location:{kind:'id',target:r.artifact_id}});
export const envelope=(kind,id=kind)=>({schema_version:1,artifact_kind:kind,artifact_id:id,revision:1,repository:'example/synthetic',recorded_at:time,recorded_by:ai,input_digest:'a'.repeat(64),evidence_refs:[source('evidence')]});
export function fixture(){
 const profile={...envelope('profile'),human_owner:'gorillaimo',risk:'high',allowed_stages:['validation'],allowed_paths:['src'],forbidden_paths:['secrets'],required_acs:['ac-1'],review_required:true,review_omission_reason:'',max_age_seconds:3600,stop_severities:['critical','high'],delegates:[],commands:[{command_id:'unit',executable:'node',argv:['--test']}],checks:[{check_id:'unit',kind:'verification',domain:'app',acs:['ac-1'],command_id:'unit',test_check:true,min_tests:1}],limits:{max_issues:10,max_concurrent_issues:2,max_ai_processes:3,run_seconds:21600,cleanup_seconds:600,call_seconds:1800,max_repairs:3,cost:{status:'known',amount:10,unit:'synthetic-units'}},approval_refs:[source('policy-approval')]};
 const subject={issue_number:1,work_id:'issue-1',run_id:'run-1',attempt:1,base_sha:'1'.repeat(40),head_sha:'2'.repeat(40),plan:{id:'plan-1',revision:1,digest:'b'.repeat(64)},profile:ref(profile)};
 const target={...subject,contract_digest:'c'.repeat(64),design_digest:'d'.repeat(64),stages:['validation'],allowed_paths:['src'],forbidden_paths:['secrets'],shared_areas:['common'],approval_refs:[source('design-approval')]};
 const grant={...envelope('grant'),run_id:'run-1',profile:ref(profile),human_owner:'gorillaimo',request:{mode:'continue',actor:human,reference:source('request')},policy_approval_refs:[source('policy-approval')],issued_at:'2026-11-04T00:00:00Z',expires_at:'2026-11-04T06:00:00Z',revoked:false,selected:[target]};
 const verification={...envelope('verification','unit-1'),subject,check_id:'unit',domain:'app',acs:['ac-1'],command_id:'unit',argv_redacted:['--test'],environment:'synthetic-node',tool_version:'24',started_at:'2026-11-04T00:01:00Z',finished_at:'2026-11-04T00:02:00Z',status:'passed',exit_code:0,test_count:2,scope:['src'],log_refs:[source('unit-log')]};
 const review={...envelope('review','review-1'),subject,implementer:{actor:ai,context_id:'impl-1'},reviewer:{actor:reviewer,context_id:'review-1'},execution_status:'completed',started_at:'2026-11-04T00:03:00Z',finished_at:'2026-11-04T00:04:00Z',status:'passed',requirements_refs:[source('requirements')],diff_refs:[source('diff')],verification_refs:[ref(verification)],findings:[]};
 const context={schema_version:1,artifact_kind:'context',repository:'example/synthetic',evaluated_at:time,subject,grant:ref(grant),human_owner:'gorillaimo',stage:'validation',contract_digest:target.contract_digest,design_digest:target.design_digest,allowed_paths:['src'],forbidden_paths:['secrets'],facts:['identity','authority','inventory','approval','assignment','ready'].map(fact_id=>({fact_id,value:true,observed_at:time,evidence_refs:[source(fact_id)]})),integration_targets:[]};
 return {profile,grant,context,verifications:[verification],reviews:[review],securityResults:[],integrationResults:[]};
}
export function rebind(s){
 const p=ref(s.profile);s.grant.profile=p;for(const x of s.grant.selected)x.profile=p;
 s.context.subject.profile=p;for(const x of [...s.verifications,...s.reviews,...s.securityResults])x.subject.profile=p;
 s.context.grant=ref(s.grant);
 for(const r of s.reviews)r.verification_refs=s.verifications.filter(v=>hash(v.subject)===hash(r.subject)).map(ref);
 return s;
}
export function finding(status='open'){
 return {finding_id:'finding-1',category:'defect',severity:'high',subject:fixture().context.subject,path:'src/index.js',line:1,specification_refs:[source('ac-1')],evidence_refs:[source('finding-evidence')],impact:'Synthetic access boundary failure',status,required_ac:true};
}
export function security(s){return {...envelope('security-result','security-1'),subject:s.context.subject,check_id:'secrets',scanner:'synthetic-scanner',scanner_version:'1',rules_version:'1',database_version:'1',database_fetched_at:'2026-11-04T00:00:00Z',formats:['javascript'],exclusions:[],supported:true,started_at:'2026-11-04T00:01:00Z',finished_at:'2026-11-04T00:02:00Z',status:'passed',log_refs:[source('security-log')],findings:[]};}
export function integration(s){return {...envelope('integration-result','integration-1'),run_id:s.grant.run_id,profile:ref(s.profile),main_sha:s.context.subject.base_sha,targets:[{issue_number:1,pr_number:2,head_sha:s.context.subject.head_sha,plan_digest:s.context.subject.plan.digest,depends_on:[]}],scope:['src'],started_at:'2026-11-04T00:05:00Z',finished_at:'2026-11-04T00:06:00Z',status:'passed',log_refs:[source('integration-log')]};}
export function report(s){return {...envelope('run-report'),run_id:s.grant.run_id,profile:ref(s.profile),grant:ref(s.grant),started_at:s.grant.issued_at,finished_at:time,termination_reason:'completed',subjects:[{issue_number:1,head_sha:s.context.subject.head_sha,pr_number:2,result_refs:[...s.verifications,...s.reviews].map(ref),repair_refs:[],unresolved_refs:[],not_evaluated:['live-execution'],human_decisions:[]}],usage:{status:'unknown'},recommended_merge_order:[1]};}
export function event(s){return {...envelope('event','event-1'),run_id:s.grant.run_id,profile:ref(s.profile),operation_id:'op-1',operation_kind:'record',issue_number:1,status:'confirmed',occurred_at:time,claim_id:'claim-1',worker_id:'worker-1',generation:1};}
