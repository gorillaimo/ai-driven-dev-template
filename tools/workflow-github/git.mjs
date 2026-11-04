import {createHash}from'node:crypto';
import {badJson,safePath,within,nowValid,MAX,fail}from'./core.mjs';
export function gitObjectSha(type,bytes){const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);return createHash('sha1').update(Buffer.from(type+' '+data.length+'\0')).update(data).digest('hex');}
export function buildGitObjects(input){
  if(badJson(input)||!input||Object.keys(input).some(k=>!['base','changes','operation_id','created_at','scope'].includes(k)))fail('git_input_invalid');
  const{base,changes,operation_id,created_at,scope}=input;
  if(!base||base.truncated!==false||!/^[a-f0-9]{40}$/.test(base.sha)||!Array.isArray(base.tree)||base.tree.length>10000||!Array.isArray(changes)||!changes.length||changes.length>MAX.file_count||!/^[a-z0-9_-]+$/.test(operation_id)||!nowValid(created_at)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(created_at)||!Array.isArray(scope?.allowed_paths)||!Array.isArray(scope?.forbidden_paths))fail('git_input_invalid');
  const files=new Map(),objects=[],changed=new Set();let bytes=0;
  for(const row of base.tree){if(!safePath(row.path)||!/^[a-f0-9]{40}$/.test(row.sha)||!['100644','100755','040000'].includes(row.mode)||!['blob','tree'].includes(row.type)||(row.mode==='040000')!==(row.type==='tree'))fail('git_tree_invalid');if(row.type==='tree')continue;if(files.has(row.path))fail('git_tree_invalid');files.set(row.path,{mode:row.mode,sha:row.sha});}
  for(const row of changes){
    if(!row||Object.keys(row).some(k=>!['path','action','content','mode'].includes(k))||!safePath(row.path)||row.path==='.github/workflows'||row.path.startsWith('.github/workflows/')||!within(row.path,scope.allowed_paths)||within(row.path,scope.forbidden_paths)||changed.has(row.path))fail('git_scope_invalid');changed.add(row.path);
    if(row.action==='delete'){if(!files.has(row.path)||Object.keys(row).some(k=>!['path','action'].includes(k)))fail('git_change_invalid');files.delete(row.path);continue;}
    if(row.action!=='set'||typeof row.content!=='string'||row.content.includes('\0')||!['100644','100755'].includes(row.mode)||Buffer.byteLength(row.content)>MAX.file_bytes)fail('git_change_invalid');
    bytes+=Buffer.byteLength(row.content);if(bytes>MAX.change_bytes)fail('git_change_limit');const sha=gitObjectSha('blob',row.content);objects.push({kind:'blobs',sha,body:{content:Buffer.from(row.content).toString('base64'),encoding:'base64'}});files.set(row.path,{mode:row.mode,sha});
  }
  const root=new Map();
  for(const[path,file]of files){const parts=path.split('/');let node=root;for(const name of parts.slice(0,-1)){if(node.has(name)&&!(node.get(name)instanceof Map))fail('git_tree_invalid');if(!node.has(name))node.set(name,new Map());node=node.get(name);}const name=parts.at(-1);if(node.has(name))fail('git_tree_invalid');node.set(name,file);}
  function tree(node){
    const entries=[...node].map(([path,value])=>value instanceof Map?{path,mode:'040000',type:'tree',sha:tree(value)}:{path,mode:value.mode,type:'blob',sha:value.sha});entries.sort((a,b)=>Buffer.compare(Buffer.from(a.path+(a.type==='tree'?'/':'')),Buffer.from(b.path+(b.type==='tree'?'/':''))));
    const raw=Buffer.concat(entries.map(e=>Buffer.concat([Buffer.from((e.type==='tree'?'40000':e.mode)+' '+e.path+'\0'),Buffer.from(e.sha,'hex')]))),sha=gitObjectSha('tree',raw);objects.push({kind:'trees',sha,body:{tree:entries}});return sha;
  }
  const treeSha=tree(root),message='workflow-github: '+operation_id+'\n',name='workflow-github',email='workflow-github@users.noreply.github.com',seconds=Math.floor(Date.parse(created_at)/1000),person=name+' <'+email+'> '+seconds+' +0000';
  const raw='tree '+treeSha+'\nparent '+base.sha+'\nauthor '+person+'\ncommitter '+person+'\n\n'+message,sha=gitObjectSha('commit',raw);
  const body={message,tree:treeSha,parents:[base.sha],author:{name,email,date:created_at},committer:{name,email,date:created_at}};
  objects.push({kind:'commits',sha,body});if(objects.length+10>MAX.operation_requests)fail('git_object_limit');
  return{commit:{...body,sha},objects};
}
