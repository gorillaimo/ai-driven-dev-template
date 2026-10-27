import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProjectPlan } from '../../tools/workflow-project/check.mjs';
import { input, feature, bind, state, clone, revised, approval } from './helpers.mjs';
const block=(i,code)=>{const r=checkProjectPlan(i);assert.equal(r.status,'blocked');assert.deepEqual(r.waves,[]);assert.ok(r.diagnostics.some(d=>d.code===code),JSON.stringify(r.diagnostics));return r;};
test('revision 2 requires a matching previous snapshot',()=>{const i=revised(input(),[feature('a'),feature('b',['a'])],['a','b'],[1]);delete i.previous;block(i,'previous_required');});
test('append-only revision 2 reports change and downstream impact',()=>{
 const old=input([feature('a'),feature('b',['a']),feature('free')]);
 const i=revised(old,[feature('a'),feature('b',['a','free']),feature('free')],['b'],[2]);const r=checkProjectPlan(i);
 assert.equal(r.status,'pass');assert.deepEqual(r.revision_impact.changed_feature_ids,['b']);assert.deepEqual(r.revision_impact.affected_feature_ids,['b']);assert.deepEqual(r.revision_impact.invalidated_waves,[2]);
});
test('same revision permits a new fact snapshot but never replacing the plan',()=>{
 const i=input([feature('a'),feature('b',['a'])]);i.previous=clone(i);state(i,'a','completed');assert.equal(checkProjectPlan(i).status,'pass');
 i.deliveryPlan.features[1].depends_on=[];bind(i);block(i,'revision_invalid');
});
for(const mode of ['skipped','rollback','identity','history','project_digest'])test('invalid prior revision '+mode,()=>{
 const old=input(),i=revised(old,[feature('a'),feature('b',['a'])],['a','b'],[1]);
 if(mode==='skipped')i.deliveryPlan.revision=3;if(mode==='rollback')i.previous.deliveryPlan.revision=3;if(mode==='identity')i.previous.project.project_id='other-project';
 if(mode==='history')i.deliveryPlan.revision_history[0].revision=3;if(mode==='project_digest')i.previous.context.project_digest='f'.repeat(64);
 bind(i);block(i,mode==='project_digest'?'context_mismatch':mode==='identity'?'identity_mismatch':'revision_invalid');
});
test('previous schema and graph are validated before reuse',()=>{
 const i=revised(input(),[feature('a'),feature('b')],['b'],[]);i.previous.deliveryPlan.features[0].depends_on=[{feature_id:'missing',reason:'Review.'}];bind(i.previous);block(i,'unknown_dependency');
});
test('history 2..N is preserved, including approval records',()=>{
 const v2=revised(input(),[feature('a'),feature('b',['a'])],['b'],[]);const old=clone(v2);delete old.previous;
 const v3=revised(old,[feature('a'),feature('b',['a']),feature('c',['b'])],['c'],[]);
 assert.equal(checkProjectPlan(v3).status,'pass');v3.deliveryPlan.revision_history[0].reason='Rewritten.';bind(v3);block(v3,'history_rewritten');
});
test('missing and unknown impact IDs or old waves are rejected',()=>{
 const old=input([feature('a'),feature('b',['a'])]);
 for(const [ids,ws,code] of [[[],[2],'impact_missing'],[['b'],[],'waves_missing'],[['b','ghost'],[2],'impact_unknown'],[['b'],[7],'wave_unknown']]){
 const changed=feature('b',['a']);changed.source_ref.fragment='reviewed-b';
 const i=revised(old,[feature('a'),changed],ids,ws);block(i,code);
 }
});
test('dependency change reaches downstream in the old and new graphs',()=>{
 const old=input([feature('a'),feature('b',['a']),feature('c',['b']),feature('free')]);
 const i=revised(old,[feature('a'),feature('b',['free']),feature('c',['b']),feature('free')],['b','c'],[2,3]);
 const r=checkProjectPlan(i);assert.equal(r.status,'pass');assert.deepEqual(r.revision_impact.affected_feature_ids,['b','c']);
});
test('priority change conservatively invalidates all features',()=>{
 const old=input([feature('a'),feature('b')]),i=revised(old,[feature('a',[],[],2),feature('b')],['a','b'],[1]);
 assert.equal(checkProjectPlan(i).status,'pass');i.deliveryPlan.revision_history[0].affected_feature_ids=['a'];bind(i);block(i,'impact_missing');
});
test('deleted features retain their old IDs in history',()=>{
 const old=input([feature('a'),feature('b',['a'])]),i=revised(old,[feature('a')],['b'],[2]);assert.equal(checkProjectPlan(i).status,'pass');
 const j=revised(old,[feature('a')],[],[2]);block(j,'impact_missing');
});
test('area changes need both project and plan revisions and affect conflict peers',()=>{
 const old=input([feature('a',[],['backend']),feature('b',[],['contracts'])]);
 const i=revised(old,clone(old.deliveryPlan.features),['a','b'],[1]);i.project.areas[0].paths=['docs'];i.project.revision++;bind(i);assert.equal(checkProjectPlan(i).status,'pass');
 i.project.revision--;bind(i);block(i,'revision_invalid');
});
test('conflict peers and their dependents are in the impact closure',()=>{
 const old=input([feature('a',[],['backend']),feature('b',[],['backend']),feature('c',['b'])]);
 const i=revised(old,[feature('a',[],[]),feature('b',[],['backend']),feature('c',['b'])],['a','b','c'],[1,2,3]);assert.equal(checkProjectPlan(i).status,'pass');
 i.deliveryPlan.revision_history[0].affected_feature_ids=['a'];bind(i);block(i,'impact_missing');
});
for(const decision of ['continue','pause','cancel'])test('active affected feature requires and preserves human decision '+decision,()=>{
 const old=state(input([feature('a'),feature('b',['a'])]),'a','active'),i=revised(old,[feature('a',[],[],2),feature('b',['a'])],['a','b'],[]);
 block(i,'active_decision_required');i.context.replan_decisions=[{feature_id:'a',decision,approval:clone(approval)}];
 const r=checkProjectPlan(i);assert.equal(r.status,'pass');assert.deepEqual(r.active,['a']);assert.deepEqual(r.waves,[]);assert.deepEqual(r.revision_impact.active_decisions,[{feature_id:'a',decision}]);
});
test('an active feature removed from the plan still needs a decision',()=>{
 const old=state(input(),'a','active'),i=revised(old,[],['a'],[]);block(i,'active_decision_required');
 i.context.replan_decisions=[{feature_id:'a',decision:'cancel',approval:clone(approval)}];assert.equal(checkProjectPlan(i).status,'pass');
});
test('previously active work cannot be rescheduled by changing its fact to planned',()=>{
 const old=state(input(),'a','active'),i=revised(old,[feature('a',[],[],2)],['a'],[]);
 i.context.feature_facts[0]={feature_id:'a',state:'planned'};
 i.context.replan_decisions=[{feature_id:'a',decision:'continue',approval:clone(approval)}];
 block(i,'active_state_regression');
});
test('initial history must be empty and revision reasons nonblank',()=>{
 const i=revised(input(),[feature('a'),feature('b')],['b'],[]);i.deliveryPlan.revision_history[0].reason=' ';bind(i);block(i,'invalid_reason');
 const j=input();j.deliveryPlan.revision_history=clone(i.deliveryPlan.revision_history);bind(j);block(j,'revision_invalid');
});
