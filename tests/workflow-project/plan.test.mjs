import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProjectPlan, validateArtifact } from '../../tools/workflow-project/check.mjs';
import { input, feature, bind, state, ref, clone, freeze } from './helpers.mjs';

const blocked = (i, code) => { const r=checkProjectPlan(i); assert.equal(r.status,'blocked'); assert.deepEqual(r.waves,[]); assert.deepEqual(r.dependency_candidates,[]); if(code)assert.ok(r.diagnostics.some(d=>d.code===code),JSON.stringify(r.diagnostics)); return r; };
const waves = r => r.waves.map(w=>w.feature_ids);
test('single feature returns a schema-valid read-only plan',()=>{
 const i=input(), before=clone(i), r=checkProjectPlan(freeze(i));
 assert.equal(r.status,'pass'); assert.deepEqual(waves(r),[['a']]); assert.deepEqual(r.dependency_candidates,['a']);
 assert.equal(validateArtifact('result',r).valid,true); assert.deepEqual(i,before);
 assert.ok(r.not_evaluated.includes('membership_permission_capacity')); assert.ok(r.not_evaluated.includes('reference_existence'));
});
test('diamond graph uses dependencies before priority',()=>{
 const i=input([feature('end',['left','right'],[],1),feature('right',['root'],[],3),feature('root',[],[],9),feature('left',['root'],[],2)]);
 const r=checkProjectPlan(i); assert.equal(r.status,'pass'); assert.deepEqual(waves(r),[['root'],['left','right'],['end']]); assert.deepEqual(r.dependency_candidates,['root']);
});
test('stable ASCII tie break and feature order independence',()=>{
 const i=input([feature('a_b'),feature('a1'),feature('a-b')]); const a=checkProjectPlan(i);
 assert.deepEqual(waves(a),[['a-b','a1','a_b']]); i.deliveryPlan.features.reverse();i.context.feature_facts.reverse();bind(i);
 assert.deepEqual(checkProjectPlan(i).waves,a.waves);
});
test('object key order cannot change the result or digest',()=>{
 const i=input(), reverse=v=>Array.isArray(v)?v.map(reverse):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reverse(x)])):v;
 assert.deepEqual(checkProjectPlan(reverse(i)),checkProjectPlan(i));
});
test('same-area changes serialize even disjoint_scopes',()=>{
 const i=input([feature('b',[],['backend'],2),feature('a',[],['backend'],1)]),r=checkProjectPlan(i);
 assert.deepEqual(waves(r),[['a'],['b']]);assert.deepEqual(r.dependency_candidates,['a']);
 assert.ok(r.serialization.some(s=>s.feature_id==='b'&&s.after_feature_ids.includes('a')));
 assert.ok(r.not_evaluated.includes('disjoint_scope_proof'));
});
test('priority can postpone independent work but cannot bypass dependency',()=>{
 const i=input([feature('a',[],['backend'],2),feature('b',[],['backend'],1),feature('c',['a'],[],1)]);
 assert.deepEqual(waves(checkProjectPlan(i)),[['b'],['a'],['c']]);
});
for(const [first,second,overlap] of [['src/api','src/api/v1',true],['src/api','src/api',true],['src/api','src/api2',false],['a','b',false]])test('area path boundary '+first+' / '+second,()=>{
 const i=input([feature('a',[],['backend']),feature('b',[],['contracts'])]);i.project.areas[0].paths=[first];i.project.areas[1].paths=[second];bind(i);
 assert.deepEqual(waves(checkProjectPlan(i)),overlap?[['a'],['b']]:[['a','b']]);
});
test('completed dependency is satisfied and never rescheduled',()=>{
 const i=state(input([feature('a'),feature('b',['a'])]),'a','completed'),r=checkProjectPlan(i);
 assert.deepEqual(waves(r),[['b']]);assert.deepEqual(r.dependency_candidates,['b']);assert.deepEqual(r.completed,['a']);
});
for(const value of ['active','blocked','cancelled','unknown'])test(value+' dependency waits without blocking unrelated feature',()=>{
 const i=state(input([feature('a'),feature('b',['a']),feature('c',['b']),feature('free')]),'a',value),r=checkProjectPlan(i);
 assert.equal(r.status,'pass');assert.deepEqual(waves(r),[['free']]);assert.deepEqual(r.waiting.map(w=>w.feature_id),value==='active'||value==='cancelled'?['b','c']:['a','b','c']);
});
test('active area conflict also prevents a planned descendant',()=>{
 const i=state(input([feature('busy',[],['backend']),feature('a',[],['backend']),feature('b',['a']),feature('free')]),'busy','active'),r=checkProjectPlan(i);
 assert.deepEqual(waves(r),[['free']]);assert.deepEqual(r.active,['busy']);assert.ok(r.waiting.find(w=>w.feature_id==='a').reasons.includes('active_area_conflict'));
});
for(const kind of ['approval','external_dependency','shared_area'])for(const fact of ['absent','pending','unknown','satisfied'])test(kind+' constraint '+fact,()=>{
 const f=feature('a',[],kind==='shared_area'?['contracts']:[]);f.constraints=[{kind,reference:clone(ref),reason:'Needs review.',...(kind==='shared_area'?{area_id:'contracts'}:{})}];
 const i=input([f,feature('b',['a']),feature('free')]);if(fact!=='absent')i.context.constraint_facts=[{feature_id:'a',constraint_index:0,state:fact,...(fact==='satisfied'?{evidence:clone(ref)}:{})}];
 const r=checkProjectPlan(i);assert.equal(r.status,'pass');assert.deepEqual(waves(r),fact==='satisfied'?[['a','free'],['b']]:[['free']]);
});
test('empty feature registry is incomplete, never an available task',()=>{
 const r=checkProjectPlan(input([]));assert.equal(r.status,'pass');assert.deepEqual(r.waves,[]);assert.deepEqual(r.dependency_candidates,[]);assert.ok(r.not_evaluated.includes('empty_plan'));
});
test('uncreated and multiple Issue references are allowed without task selection',()=>{
 const i=input();i.deliveryPlan.features[0].issue_refs=[1,2].map(n=>({issue_ref:'https://github.com/example/project/issues/'+n,work_id:'issue-'+n,required:n===1}));bind(i);
 const r=checkProjectPlan(i);assert.equal(r.status,'pass');assert.ok(!('selected_issue' in r));
});
const invalids = [
 ['duplicate_feature',i=>i.deliveryPlan.features.push(clone(i.deliveryPlan.features[0]))],
 ['duplicate_area',i=>i.project.areas.push(clone(i.project.areas[0]))],
 ['unknown_dependency',i=>i.deliveryPlan.features[0].depends_on=[{feature_id:'missing',reason:'Needs contract.'}]],
 ['self_dependency',i=>i.deliveryPlan.features[0].depends_on=[{feature_id:'a',reason:'Needs contract.'}]],
 ['duplicate_dependency',i=>{i.deliveryPlan.features.push(feature('b'));i.context.feature_facts.push({feature_id:'b',state:'planned'});i.deliveryPlan.features[0].depends_on=[{feature_id:'b',reason:'One.'},{feature_id:'b',reason:'Two.'}];}],
 ['unknown_area',i=>i.deliveryPlan.features[0].area_ids=['missing']],
 ['identity_mismatch',i=>i.deliveryPlan.project_id='other-project'],
 ['invalid_reason',i=>{i.deliveryPlan.features.push(feature('b'));i.context.feature_facts.push({feature_id:'b',state:'planned'});i.deliveryPlan.features[0].depends_on=[{feature_id:'b',reason:'  '}];}],
 ['invalid_shared_area',i=>i.deliveryPlan.features[0].constraints=[{kind:'shared_area',area_id:'backend',reference:clone(ref),reason:'Review.'}]],
 ['invalid_shared_area',i=>i.deliveryPlan.features[0].constraints=[{kind:'shared_area',area_id:'contracts',reference:clone(ref),reason:'Review.'}]],
 ['invalid_issue_identity',i=>i.deliveryPlan.features[0].issue_refs=[{issue_ref:'https://github.com/other/project/issues/1',work_id:'issue-1',required:true}]],
 ['invalid_issue_identity',i=>i.deliveryPlan.features[0].issue_refs=[{issue_ref:'https://github.com/example/project/issues/1',work_id:'issue-2',required:true}]],
 ['invalid_issue_identity',i=>i.deliveryPlan.features[0].issue_refs=[{issue_ref:'https://evil.example/example/project/issues/1',work_id:'issue-1',required:true}]],
 ['duplicate_issue',i=>{const r={issue_ref:'https://github.com/example/project/issues/1',work_id:'issue-1',required:true};i.deliveryPlan.features[0].issue_refs=[r,clone(r)];}],
 ['duplicate_fact',i=>i.context.feature_facts.push(clone(i.context.feature_facts[0]))],
 ['missing_fact',i=>i.context.feature_facts=[]],
 ['unknown_fact',i=>i.context.feature_facts.push({feature_id:'missing',state:'planned'})],
 ['unknown_fact',i=>i.context.constraint_facts=[{feature_id:'a',constraint_index:0,state:'pending'}]],
 ['unknown_fact',i=>i.context.replan_decisions=[{feature_id:'missing',decision:'continue',approval:{approval_type:'replan',approved_by:'example-user',approved_at:'2026-10-27T00:00:00Z',reference:clone(ref)}}]],
];
for(const [n,[code,mutate]] of invalids.entries())test('rejects '+code+' '+n,()=>{const i=input();mutate(i);bind(i);blocked(i,code);});
for(const key of ['project_id','project_revision','plan_revision','project_digest','plan_digest'])test('stale context '+key,()=>{
 const i=input();i.context[key]=key.endsWith('digest')?'f'.repeat(64):key==='project_id'?'other-project':2;blocked(i,'context_mismatch');
});
for(const kind of ['project','deliveryPlan','context'])for(const mutation of ['version','unknown','missing'])test('schema '+kind+' '+mutation,()=>{
 const i=input();if(mutation==='version')i[kind].schema_version=99;else if(mutation==='unknown')i[kind].secret='PRIVATE_CANARY';else delete i[kind][kind==='context'?'source':'updated_by'];bind(i);blocked(i,'schema_invalid');
});
for(const fact of ['active','completed','blocked','cancelled'])test('fact '+fact+' needs evidence',()=>{const i=input();i.context.feature_facts[0].state=fact;blocked(i,'schema_invalid');});
test('AI recorder must name its human principal',()=>{const i=input();i.context.recorded_by={actor_type:'ai',actor_ref:'codex'};blocked(i,'schema_invalid');});
test('cycles return a deterministic closed path, even for completed facts',()=>{
 const i=input([feature('a',['b']),feature('b',['c']),feature('c',['a'])]);i.context.feature_facts.forEach(f=>Object.assign(f,{state:'completed',evidence:clone(ref)}));
 const r=blocked(i,'dependency_cycle'),cycle=r.diagnostics.find(d=>d.code==='dependency_cycle').related;assert.deepEqual(cycle,['a','b','c','a']);assert.deepEqual(checkProjectPlan(i),r);
});
test('duplicate Issue across different features is blocked',()=>{
 const i=input([feature('a'),feature('b')]);i.deliveryPlan.features.forEach(f=>f.issue_refs=[{issue_ref:'https://github.com/example/project/issues/1',work_id:'issue-1',required:true}]);bind(i);blocked(i,'duplicate_issue');
});
test('unknown constraint result state and satisfied without evidence are rejected',()=>{
 for(const state of ['satisfied','approved']){const i=input();i.context.constraint_facts=[{feature_id:'a',constraint_index:0,state}];blocked(i,'schema_invalid');}
});
test('sorted path merge agrees with independent prefix checks for multiple paths',()=>{
 const pool=['src','src/api','src/api-v1','src/api/v1','src/api2','src_api','a','a-b','a/b','z'];
 for(let n=0;n<40;n++){
  const a=pool.filter((_,j)=>(j+n)%3===0),b=pool.filter((_,j)=>(j*3+n)%7===0);
  const expected=a.some(x=>b.some(y=>x===y||x.startsWith(y+'/')||y.startsWith(x+'/')));
  const i=input([feature('a',[],['backend']),feature('b',[],['contracts'])]);i.project.areas[0].paths=a;i.project.areas[1].paths=b.length?b:['unrelated'];bind(i);
  assert.equal(checkProjectPlan(i).waves.length,expected?2:1);
 }
});
test('duplicate condition records cannot be used as alternative proofs',()=>{
 const i=input();const c={feature_id:'a',constraint_index:0,state:'satisfied',evidence:clone(ref)};
 i.deliveryPlan.features[0].constraints=[{kind:'approval',reference:clone(ref),reason:'Review.'}];i.context.constraint_facts=[c,clone(c)];bind(i);blocked(i,'duplicate_fact');
});
test('extension flags cannot make an unconfirmed constraint pass',()=>{
 const i=input();i.deliveryPlan.features[0].constraints=[{kind:'approval',reference:clone(ref),reason:'Review.'}];i.deliveryPlan.extensions={approved:true,skip_checks:true};bind(i);
 const r=checkProjectPlan(i);assert.equal(r.status,'pass');assert.deepEqual(r.waves,[]);assert.deepEqual(r.dependency_candidates,[]);
});
test('result contract rejects unknown versions, fields and unsupported statuses',()=>{
 for(const mutate of [r=>r.schema_version=2,r=>r.claim_id='unauthorized',r=>r.status='authorized']){const r=checkProjectPlan(input());mutate(r);assert.equal(validateArtifact('result',r).valid,false);}
});
export { blocked };
