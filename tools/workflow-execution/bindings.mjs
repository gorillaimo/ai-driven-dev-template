import { canonical, digest } from 'workflow-rules/resolve';
export const hash=value=>digest(canonical(value));
export const same=(a,b)=>canonical(a)===canonical(b);
export const recordKinds={verifications:'verification',reviews:'review',securityResults:'security-result',integrationResults:'integration-result',events:'event'};
export const referenceKinds=new Set(['profile','grant',...Object.values(recordKinds),'run-report']);
export const key=r=>r.kind+'|'+r.id+'|'+r.revision;
export const identity=r=>r.artifact_kind+'|'+r.artifact_id+'|'+r.revision;
export function records(s){return [s.profile,s.grant,...s.verifications,...s.reviews,...s.securityResults,...s.integrationResults,...(s.report?[s.report]:[]),...(s.events??[])];}
export function matches(ref,record){return ref.kind===record.artifact_kind&&ref.id===record.artifact_id&&ref.revision===record.revision&&ref.digest===hash(record);}
export const within=(path,roots)=>roots.some(root=>path===root||path.startsWith(root+'/'));
export function subjectOf(target){const {issue_number,work_id,run_id,attempt,base_sha,head_sha,plan,profile}=target;return {issue_number,work_id,run_id,attempt,base_sha,head_sha,plan,profile};}
export function findingOrigin(f){const value={...f,status:'open'};delete value.resolution;delete value.exception;return hash(value);}
