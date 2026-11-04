import {spawn} from 'node:child_process';
export function executeProcess(file,args,{timeoutMs=30000,maxBytes=1024*1024,env=process.env,cwd,signal,binary=false}={}){
 return new Promise(resolve=>{
  let child,stdout=[],stderr=[],bytes=0,limited=false,timedOut=false,settled=false;
  const done=(code,error)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(force);resolve({code,stdout:binary?Buffer.concat(stdout):Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8'),limited,timedOut,error});};
  let force;const stop=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}force=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},1000);};
  const timer=setTimeout(()=>{timedOut=true;if(child)stop();},timeoutMs);
  try{child=spawn(file,args,{cwd,env,shell:false,detached:true,stdio:['ignore','pipe','pipe'],signal});}catch{done(null,true);return;}
  for(const [stream,list]of [[child.stdout,stdout],[child.stderr,stderr]])stream.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){if(!limited){limited=true;stop();}return;}list.push(chunk);});
  child.on('error',()=>done(null,true));child.on('close',code=>done(code,false));
 });
}
