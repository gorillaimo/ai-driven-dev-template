// Synthetic fixture factory; never reads application data or runs recorded commands.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseYaml } from '../../../tools/workflow-rules/load.mjs';
const source=new URL('../../../.ai-workflow/templates/issue/v1/',import.meta.url);
export const kinds=['plan','state','traceability','brownfield'];
export const ref={kind:'file',target:'docs/evidence.md'};
export function artifact(kind){
 const value=parseYaml(readFileSync(new URL(kind+'.yaml',source),'utf8'));
 function replace(v){if(!v||typeof v!=='object')return;if(['file','url','id'].includes(v.kind)&&typeof v.target==='string'){Object.keys(v).forEach(k=>delete v[k]);Object.assign(v,ref);return;}for(const child of Object.values(v))replace(child);}
 replace(value);return value;
}
export function put(root,path,value){mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');}
export const pathFor=(kind,id='issue-1')=>'.ai-workflow/issues/'+id+'/'+kind+'.yaml';
export function setup(root,selected=kinds){put(root,'docs/evidence.md','# Evidence {#known}\nSynthetic source, not approval.\n');for(const kind of selected)put(root,pathFor(kind),artifact(kind));}
export function temporary(action){const root=mkdtempSync(join(tmpdir(),'workflow-ci-'));try{return action(root);}finally{rmSync(root,{recursive:true,force:true});}}
