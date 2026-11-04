import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadExecutionEvidence as load } from '../../tools/workflow-execution/load.mjs';
import { checkExecutionEvidence as check } from '../../tools/workflow-execution/check.mjs';
import { fixture } from './fixture.mjs';
const paths={profile:'profile.yaml',grant:'grant.yaml',context:'context.yaml',verifications:['v.yaml'],reviews:['r.yaml'],securityResults:[],integrationResults:[]};
function setup(){const dir=mkdtempSync(join(tmpdir(),'execution-'));const s=fixture();for(const [key,path] of Object.entries(paths)){if(Array.isArray(path))path.forEach((p,i)=>writeFileSync(join(dir,p),JSON.stringify(s[key][i])));else writeFileSync(join(dir,path),JSON.stringify(s[key]));}return dir;}
test('explicit loader reads only named files and never follows references or executes commands',()=>{const dir=setup();try{const before=readdirSync(dir).map(p=>[p,readFileSync(join(dir,p),'utf8')]);writeFileSync(join(dir,'unrequested.yaml'),'!danger bad');assert.equal(check(load(dir,paths)).status,'pass');for(const [p,data]of before)assert.equal(readFileSync(join(dir,p),'utf8'),data);}finally{rmSync(dir,{recursive:true});}});
for(const path of ['../escape','/etc/passwd','https://example.test/a','a/../b','a\\b'])test('reject unsafe path '+path,()=>{const dir=setup();try{assert.throws(()=>load(dir,{...paths,profile:path}),/^Error: execution_load_invalid$/);}finally{rmSync(dir,{recursive:true});}});
for(const [name,write] of [['alias',d=>writeFileSync(join(d,'bad'),'x: &x {}\ny: *x')],['tag',d=>writeFileSync(join(d,'bad'),'!foo {}')],['duplicate',d=>writeFileSync(join(d,'bad'),'x: 1\nx: 2')],['oversize',d=>writeFileSync(join(d,'bad'),'x'.repeat(1024*1024+1))],['symlink',d=>symlinkSync(join(d,'profile.yaml'),join(d,'bad'))],['directory',d=>mkdirSync(join(d,'bad'))]])test('reject loader '+name,()=>{const dir=setup();try{write(dir);assert.throws(()=>load(dir,{...paths,profile:'bad'}),/^Error: execution_load_invalid$/);}finally{rmSync(dir,{recursive:true});}});
test('unknown paths, nested previous, duplicate files rejected',()=>{const dir=setup();try{for(const p of [{...paths,unknown:'bad'},{...paths,profile:paths.grant},{...paths,previous:{...paths,previous:paths}}])assert.throws(()=>load(dir,p));}finally{rmSync(dir,{recursive:true});}});
