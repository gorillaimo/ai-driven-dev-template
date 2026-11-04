import {canonical,digest} from 'workflow-rules/resolve';
import {readFileSync} from 'node:fs';
export const hash=v=>digest(canonical(v));
export const same=(a,b)=>canonical(a)===canonical(b);
export const catalog=JSON.parse(readFileSync(new URL('./tools.lock.json',import.meta.url),'utf8'));
export const within=(p,roots)=>roots.some(r=>p===r||p.startsWith(r+'/'));
export const fresh=(at,now,age)=>Number.isFinite(Date.parse(at))&&Date.parse(at)<=Date.parse(now)&&Date.parse(now)-Date.parse(at)<=age*1000;
export const matches=(r,v)=>r.kind===v.artifact_kind&&r.id===v.artifact_id&&r.revision===v.revision&&r.digest===hash(v);
export const diag=(code,index=0)=>({code,index});
export const maxDiagnostics=rows=>rows.length>999?[...rows.slice(0,999),diag('diagnostic_limit')]:rows;
export const snapshots=c=>{const v=structuredClone(c);delete v.rechecks;delete v.evaluated_at;return v;};
export function formatOf(p){if(/(^|\/)Dockerfile(?:\.[A-Za-z0-9_-]+)?$/.test(p))return 'dockerfile';if(p.endsWith('package-lock.json'))return 'npm';if(p.endsWith('pubspec.lock'))return 'Pub';if(/(?:requirements[^/]*\.txt|poetry\.lock|uv\.lock)$/.test(p))return 'PyPI';if(/\.[cm]?jsx?$/.test(p))return 'javascript';if(/\.tsx?$/.test(p))return 'typescript';if(p.endsWith('.py'))return 'python';if(p.endsWith('.dart'))return 'dart';if(p.endsWith('.tf'))return 'terraform';if(/\.(yaml|yml|json)$/.test(p))return 'text';return 'text';}
export function finiteTimes(value){const stack=[value];while(stack.length){const v=stack.pop();if(!v||typeof v!=='object')continue;for(const [k,x]of Object.entries(v)){if(/(?:^|_)at$/.test(k)&&typeof x==='string'&&!Number.isFinite(Date.parse(x)))return false;if(x&&typeof x==='object')stack.push(x);}}return true;}
