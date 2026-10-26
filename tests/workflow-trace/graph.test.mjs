import test from 'node:test';
import assert from 'node:assert/strict';
import {checkTraceability} from '../../tools/workflow-trace/check.mjs';
import {fixture} from './fixtures/build.mjs';
export function has(r,code){assert.ok(r.diagnostics.some(d=>d.code===code),JSON.stringify(r));}
for(const [name,mutate,code] of [
 ['duplicate node',f=>f.traceability.nodes.push(structuredClone(f.traceability.nodes[0])),'duplicate_node'],
 ['unknown endpoint',f=>f.traceability.links.push({from:'missing',to:'ac-1',relation:'references'}),'unknown_endpoint'],
 ['self link',f=>f.traceability.links.push({from:'ac-1',to:'ac-1',relation:'references'}),'self_link'],
 ['duplicate link',f=>f.traceability.links.push(structuredClone(f.traceability.links[0])),'duplicate_link'],
 ['reversed satisfies',f=>{f.traceability.links[0]={from:'ac-1',to:'req-1',relation:'satisfies'};},'invalid_relation'],
 ['fake references',f=>f.traceability.links.forEach(l=>l.relation='references'),'coverage_missing'],
 ['not applicable path',f=>{f.traceability.nodes.find(n=>n.id==='req-1').status='not_applicable';},'coverage_missing'],
 ['empty graph',f=>{f.traceability.nodes=[];f.traceability.links=[];},'inventory_mismatch'],
 ['missing change',f=>f.context.change_inventory.push({node_id:'missing-change',path:'src/other.mjs',operation:'added'}),'inventory_mismatch'],
 ['extra AC',f=>f.traceability.nodes.push({id:'ac-extra',kind:'acceptance_criterion',ref:f.context.contract_ref,status:'complete'}),'inventory_mismatch'],
 ['non scope',f=>f.traceability.links.push({from:'excluded-1',to:'change-1',relation:'excludes'}),'non_scope_violation'],
]) test(name,()=>{const f=fixture();mutate(f);assert.equal(checkTraceability(f).status,'blocked');has(checkTraceability(f),code);});
test('draft graph defects warn while invalid schema still blocks',()=>{
 const f=fixture('draft');f.traceability.links.push({from:'missing',to:'ac-1',relation:'references'});assert.equal(checkTraceability(f).status,'warn');
 f.context.schema_version=2;assert.equal(checkTraceability(f).status,'blocked');
});
test('references cycles terminate without proving coverage',()=>{
 const f=fixture();f.traceability.links.push({from:'req-1',to:'design-1',relation:'references'});assert.equal(checkTraceability(f).status,'pass');
});
