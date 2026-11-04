import { canonical, digest } from 'workflow-rules/resolve';
import { inspectJson } from '../workflow-execution/limits.mjs';
export { canonical };
export const hash = value => digest(canonical(value));
export const same = (a,b) => canonical(a) === canonical(b);
export const nowValid = at => typeof at === 'string' && Number.isFinite(Date.parse(at));
export const fresh = (at,now,seconds) => nowValid(at) && nowValid(now) && Date.parse(at)<=Date.parse(now) && Date.parse(now)-Date.parse(at)<=seconds*1000;
export const within = (path,roots) => roots.some(root => path===root || path.startsWith(root+'/'));
export const safePath = path => typeof path==='string' && /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path) && !path.split('/').includes('.git');
export const MAX = Object.freeze({ collector_seconds:60,requests:400,page_items:100,resource_items:1000,discussion_items:10000,response_bytes:2097152,raw_bytes:67108864,operation_seconds:180,operation_requests:100,file_count:32,file_bytes:1048576,change_bytes:5242880,journal_transitions:10000,journal_bytes:33554432 });
export const badJson = value => inspectJson(value);
export const OPS = ['create_branch','publish_commit','append_claim','append_record','create_draft_pr','update_draft_pr'];
export const PERMISSIONS = Object.freeze({metadata:'read',contents:'write',issues:'write',pull_requests:'write',administration:'read'});
const safeErrors=new WeakMap();
export function safeError(code){const error=new Error(code);safeErrors.set(error,code);return error;}
export function errorCode(error,fallback){return safeErrors.get(error)??fallback;}
export function fail(code){throw safeError(code);}
export const diagnostics = code => [{code}];
export const NOT_EVALUATED = ['real_human_identity','dispatcher_atomic_reservation','external_worker_isolation','protected_storage_permissions'];
export function finiteTimes(value){const stack=[value];while(stack.length){const v=stack.pop();if(!v||typeof v!=='object')continue;for(const[k,x]of Object.entries(v)){if(/(?:^|_)at$/.test(k)&&typeof x==='string'&&!nowValid(x))return false;if(x&&typeof x==='object')stack.push(x);}}return true;}
