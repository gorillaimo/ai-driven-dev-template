import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWorkflow } from '../../tools/workflow-check/check.mjs';
import { fixture, paused, finish, event, approval } from './fixtures/build.mjs';
import { has } from './plan.test.mjs';
for(const [name,change,code] of [
 ['snapshot mismatch',f=>f.state.stages[0].status='pending','history_mismatch'],
 ['two running',f=>{f.state.stages[0].status='in_progress';f.state.stages[1].status='in_progress';},'parallel_stages'],
 ['event duplicate',f=>f.state.history.push(structuredClone(f.state.history[0])),'duplicate_event'],
 ['before mismatch',f=>f.state.history[1].before='completed','invalid_transition'],
 ['event reverse time',f=>f.state.history[1].occurred_at='2020-01-01T00:00:00Z','event_time'],
 ['last completed mismatch',f=>f.state.last_completed_stage='intake','history_mismatch'],
 ['next mismatch',f=>f.state.next_stage='handoff','next_stage_mismatch'],
 ['history rewrite',f=>f.state.history[0].evidence=[{kind:'file',target:'README.md'}],'history_rewritten'],
 ['blocked missing reason',f=>{event(f,'work_resumed');event(f,'work_blocked');},'blocker_missing'],
 ['failed missing reason',f=>{event(f,'work_resumed');event(f,'work_failed');},'failure_reason_missing'],
]) test(name,()=>{const f=paused();change(f);has(checkWorkflow(f),code);});
test('TDD and dependencies checked at historical event boundary',()=>{
 const f=fixture('medium',true);event(f,'stage_started','implementation');f.state.next_stage=null;has(checkWorkflow(f),'dependency_incomplete');
});
test('High approvals must be scoped and recorded before tests start',()=>{
 const f=fixture('high',true);for(const id of ['intake','context','requirements','design','quality']) finish(f,id);
 event(f,'stage_started','tests');f.state.next_stage=null;has(checkWorkflow(f),'approval_missing');
 const approved=fixture('high',true);for(const id of ['intake','context','requirements','design','quality']) finish(approved,id);
 approval(approved,'design','design');approval(approved,'quality','quality');event(approved,'stage_started','tests');approved.state.next_stage=null;
 assert.equal(checkWorkflow(approved).checks.find(c=>c.check_id==='state').status,'pass');
 approved.state.history.find(e=>e.event_type==='approval_recorded').actor={actor_type:'ai_agent',actor_ref:'codex',on_behalf_of:'example-user'};has(checkWorkflow(approved),'approval_invalid');
});
test('terminal cannot be resurrected; completed requires validation',()=>{
 const f=paused();event(f,'work_cancelled');f.state.next_stage=null;assert.equal(checkWorkflow(f).resume_decision,'terminal');event(f,'work_resumed');has(checkWorkflow(f),'invalid_transition');
 const done=paused();event(done,'work_resumed');finish(done,'validation');finish(done,'handoff');event(done,'work_completed');done.state.next_stage=null;has(checkWorkflow(done),'validation_missing');
});
test('revision resets downstream stages and requires complete revision evidence',async()=>{
 const {revised}=await import('./fixtures/build.mjs');const f=revised();assert.equal(checkWorkflow(f).status,'pass');
 for(const [mutate,code] of [
  [x=>x.state.extensions.workflow_check.revisions[0].invalidated_stages.pop(),'revision_invalid'],
  [x=>{delete x.previous;x.revisionPlans=[];},'revision_missing'],
  [x=>x.state.history.at(-1).reason='','schema_invalid'],
  [x=>x.state.history.at(-1).plan_revision=3,'revision_missing'],
 ]) {const bad=structuredClone(f);mutate(bad);has(checkWorkflow(bad),code);}
});
test('revised plan cannot retain stale validation for a completed stage',async()=>{
 const {revised}=await import('./fixtures/build.mjs');const f=revised();event(f,'stage_started','validation');event(f,'stage_completed','validation');event(f,'work_paused');f.state.next_stage='handoff';has(checkWorkflow(f),'validation_missing');
});
test('approval granted after tests started does not retroactively approve the event',()=>{
 const f=fixture('high',true);for(const id of ['intake','context','requirements','design','quality']) finish(f,id);
 event(f,'stage_started','tests');event(f,'stage_completed','tests');approval(f,'design','design');approval(f,'quality','quality');f.state.next_stage='brownfield';has(checkWorkflow(f),'approval_missing');
});
test('missing extension is migration-required while existing schema remains unchanged',()=>{
 const f=fixture();delete f.state.extensions;has(checkWorkflow(f),'schema_invalid');
});
test('approval and validation bindings cannot refer to missing or duplicate records',()=>{
 const f=paused();f.state.extensions.workflow_check.approval_scopes.push({reference:{kind:'file',target:'README.md'},plan_revision:1,stage:'validation',contract_ref:f.context.contract_ref,event_id:'missing'});has(checkWorkflow(f),'approval_invalid');
 const v=paused();v.state.extensions.workflow_check.validation_scopes.push({validation_id:'missing',plan_revision:1,stage:'context'});has(checkWorkflow(v),'validation_missing');
});
test('deleted or changed approvals and validation bindings violate append-only evidence',()=>{
 const f=paused();f.state.validations=[];has(checkWorkflow(f),'history_rewritten');
 const g=paused();g.state.extensions.workflow_check.validation_scopes=[];has(checkWorkflow(g),'history_rewritten');
});
test('previous state must belong to its declared previous plan revision',()=>{
 const f=paused();f.previous.state.plan_revision=2;has(checkWorkflow(f),'revision_invalid');
});
test('historical stage start cannot claim a later pre-approved plan',()=>{
 const f=paused();f.state.history[1].plan_revision=2;has(checkWorkflow(f),'revision_invalid');
});
test('all-skipped or pending stages cannot manufacture completed work',()=>{
 const f=fixture();for(const s of f.state.stages) s.status='skipped';f.state.status='completed';f.state.next_stage=null;has(checkWorkflow(f),'history_mismatch');
});
test('past revision must also satisfy required workflow boundaries',async()=>{
 const {revised}=await import('./fixtures/build.mjs');const f=revised();f.revisionPlans[0].stages.find(s=>s.stage_id==='context').selection='skipped';f.previous.plan=f.revisionPlans[0];has(checkWorkflow(f),'required_stage');
});
test('all standard events are represented by fixtures',()=>{
 const f=paused();event(f,'work_resumed');event(f,'work_blocked');f.state.blockers=[{blocker_id:'review',reason:'Synthetic',evidence:[],resolution:'Review'}];
 assert.equal(checkWorkflow(f).checks.find(c=>c.check_id==='state').status,'pass');
 const failed=paused();event(failed,'work_resumed');event(failed,'work_failed');failed.state.failure_reason='Synthetic failure';assert.equal(checkWorkflow(failed).checks.find(c=>c.check_id==='state').status,'pass');
});
test('successful completion is terminal only with current validation evidence',()=>{
 const f=paused();event(f,'work_resumed');finish(f,'validation');
 f.state.validations.push({validation_id:'final',status:'passed',reference:f.context.contract_ref,executed_at:f.state.updated_at});
 f.state.extensions.workflow_check.validation_scopes.push({validation_id:'final',plan_revision:1,stage:'validation'});
 finish(f,'handoff');event(f,'work_completed');f.state.next_stage=null;
 const r=checkWorkflow(f);assert.equal(r.status,'pass');assert.equal(r.resume_decision,'terminal');
});
test('High approval from prior revision does not approve new tests',()=>{
 const f=fixture('high',true);for(const id of ['intake','context','requirements','design','quality']) finish(f,id);
 approval(f,'design','design');approval(f,'quality','quality');
 f.previous={plan:structuredClone(f.plan),state:structuredClone(f.state)};f.revisionPlans=[structuredClone(f.plan)];
 const e=event(f,'plan_revised',null,{after:'planned',reason:'Synthetic restart',plan_revision:2});
 f.state.extensions.workflow_check.revisions.push({event_id:e.event_id,from_revision:1,to_revision:2,restart_stage:'tests',invalidated_stages:['tests','implementation','validation','handoff'],invalidated_artifacts:[]});
 f.plan.revision=2;f.state.plan_revision=2;f.state.next_stage='tests';
 has(checkWorkflow(f),'approval_missing');
});
test('selected rule approval is scoped to target stage and revision',async()=>{
 const {readFileSync}=await import('node:fs');const {parseYaml}=await import('../../tools/workflow-rules/load.mjs');const {resolveRules}=await import('../../tools/workflow-rules/resolve.mjs');const {projectPlan}=await import('../../tools/workflow-rules/plan.mjs');
 const f=fixture('medium',true);const rule=parseYaml(readFileSync(new URL('../workflow-rules/fixtures/conditional.yaml',import.meta.url),'utf8'));
 f.ruleInput.rules.push(rule);f.ruleInput.context.technologies=['node'];f.plan=projectPlan(f.plan,resolveRules(f.ruleInput),f.ruleInput);
 for(const id of ['intake','context','requirements','design']) finish(f,id);
 f.state.next_stage='tests';f.state.validations.push({validation_id:'design-check',status:'passed',reference:f.context.contract_ref,executed_at:f.state.updated_at});f.state.extensions.workflow_check.validation_scopes.push({validation_id:'design-check',plan_revision:1,stage:'design'});
 f.previous={plan:structuredClone(f.plan),state:structuredClone(f.state)};has(checkWorkflow(f),'approval_missing');
 approval(f,'rule','tests','example');assert.equal(checkWorkflow(f).status,'pass');
});
test('previous snapshot must itself agree with the preserved history',()=>{
 const f=paused();f.previous.state.status='completed';has(checkWorkflow(f),'history_mismatch');
});
test('initial event cannot claim an unsupported revision',()=>{
 const f=fixture();f.state.history[0].plan_revision=2;has(checkWorkflow(f),'revision_invalid');
});
test('replan cannot erase an active stage outside its invalidated subtree',()=>{
 const f=fixture('medium',true);finish(f,'intake');finish(f,'context');event(f,'stage_started','design');
 f.previous={plan:structuredClone(f.plan),state:structuredClone(f.state)};f.revisionPlans=[structuredClone(f.plan)];
 const e=event(f,'plan_revised',null,{after:'planned',reason:'Synthetic',plan_revision:2});f.plan.revision=2;f.state.plan_revision=2;f.state.current_stage=null;f.state.next_stage='tests';
 f.state.extensions.workflow_check.revisions.push({event_id:e.event_id,from_revision:1,to_revision:2,restart_stage:'tests',invalidated_stages:['tests','implementation','validation','handoff'],invalidated_artifacts:[]});has(checkWorkflow(f),'revision_invalid');
});
test('cancellation stops an active stage instead of leaving it running',()=>{
 const f=fixture();event(f,'stage_started','intake');event(f,'work_cancelled');f.state.current_stage=null;f.state.stages[0].status='blocked';f.state.next_stage=null;
 assert.equal(checkWorkflow(f).checks.find(c=>c.check_id==='state').status,'pass');
});
