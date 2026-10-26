import test from 'node:test';
import assert from 'node:assert/strict';
import {checkTraceability} from '../../tools/workflow-trace/check.mjs';
import {fixture,stamp,ref} from './fixtures/build.mjs';
import {has} from './graph.test.mjs';
function suppressed(){
 const f=fixture();f.traceability.nodes.push({id:'orphan',kind:'design',ref:{kind:'file',target:'docs/design.md'},status:'complete'});
 const r=checkTraceability(f),d=r.diagnostics.find(d=>d.code==='orphan_node');assert.ok(d);
 f.traceability.suppressions=[{check_id:d.check_id,reason:'Synthetic false positive review',expires_at:'2026-11-01T00:00:00Z',approval:{approval_type:'suppression',approved_by:'example-user',approved_at:stamp,reference:ref}}];
 f.context.suppression_scopes=[{schema_version:1,check_id:d.check_id,subject_digest:r.subject_digest,plan_revision:1,boundary:f.context.boundary,node:d.node,edge:d.edge,path:d.path}];return f;
}
test('targeted human suppression retains original finding and yields warn',()=>{
 const f=suppressed(),r=checkTraceability(f);assert.equal(r.status,'warn');assert.equal(r.diagnostics.find(d=>d.code==='orphan_node').suppressed,true);
 f.context.evaluated_at='2026-10-27T00:00:00Z';assert.equal(checkTraceability(f).status,'warn');
});
for(const [name,mutate] of [
 ['expired',f=>f.traceability.suppressions[0].expires_at=stamp],
 ['stale digest',f=>f.context.suppression_scopes[0].subject_digest='0'.repeat(64)],
 ['unknown check',f=>f.traceability.suppressions[0].check_id='missing'],
 ['future approval',f=>f.traceability.suppressions[0].approval.approved_at='2027-01-01T00:00:00Z'],
 ['duplicate',f=>f.traceability.suppressions.push(structuredClone(f.traceability.suppressions[0]))],
]) test(name,()=>{const f=suppressed();mutate(f);has(checkTraceability(f),'suppression_invalid');});
test('scope does not broaden to another finding and input changes invalidate it',()=>{
 const f=suppressed();f.traceability.nodes.push({id:'other-orphan',kind:'design',ref:{kind:'file',target:'docs/design.md'},status:'complete'});has(checkTraceability(f),'suppression_invalid');
});
test('safety, scope violations and missing inventory cannot be suppressed',()=>{
 const f=fixture();f.traceability.links.push({from:'excluded-1',to:'change-1',relation:'excludes'});
 const r=checkTraceability(f),d=r.diagnostics.find(d=>d.code==='non_scope_violation');
 f.traceability.suppressions=[{check_id:d.check_id,reason:'Synthetic invalid override',expires_at:'2026-11-01T00:00:00Z',approval:{approval_type:'suppression',approved_by:'example-user',approved_at:stamp,reference:ref}}];
 f.context.suppression_scopes=[{schema_version:1,check_id:d.check_id,subject_digest:r.subject_digest,plan_revision:1,boundary:f.context.boundary,node:d.node,edge:d.edge,path:d.path}];
 has(checkTraceability(f),'suppression_invalid');assert.equal(checkTraceability(f).status,'blocked');
});
