import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {checkTraceability} from '../../tools/workflow-trace/check.mjs';
import {fixture} from './fixtures/build.mjs';
test('1000 nodes / 5000 edges complete within five seconds',()=>{
 const f=fixture();
 while(f.traceability.nodes.length<1000){const id='req-'+f.traceability.nodes.length;f.traceability.nodes.push({id,kind:'requirement',ref:{kind:'file',target:'docs/requirements.md'},status:'complete'});f.traceability.links.push({from:id,to:'ac-1',relation:'satisfies'});}
 const req=f.traceability.nodes.filter(n=>n.kind==='requirement');
 let offset=1,index=0;
 while(f.traceability.links.length<5000){const from=req[index].id,to=req[(index+offset)%req.length].id;f.traceability.links.push({from,to,relation:'references'});if(++index===req.length){index=0;offset++;}}
 const start=performance.now(),r=checkTraceability(f),elapsed=performance.now()-start;
 assert.equal(r.status,'pass',JSON.stringify(r.diagnostics));assert.ok(elapsed<5000);console.log('1000 nodes / 5000 edges: '+elapsed.toFixed(2)+'ms');
});
