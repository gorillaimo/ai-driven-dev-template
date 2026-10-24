import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWorkflow } from '../../tools/workflow-check/check.mjs';
import { paused } from './fixtures/build.mjs';
import { has } from './plan.test.mjs';
test('safe paused boundary proposes exactly validation',()=>{const r=checkWorkflow(paused());assert.equal(r.status,'pass');assert.equal(r.resume_decision,'candidate');assert.equal(r.next_stage,'validation');});
for(const [name,change,code] of [
 ['no prior snapshot',f=>delete f.previous,'previous_missing'],
 ['dirty tree',f=>f.context.git.clean=false,'git_changed'],
 ['remote difference',f=>f.context.git.remote_matches=false,'git_changed'],
 ['unknown remote',f=>f.context.git.remote_matches=null,'git_changed'],
 ['branch changed',f=>f.context.git.branch='other','git_changed'],
 ['Issue updated',f=>f.context.issue_updated_at='2026-10-24T00:00:00Z','issue_changed'],
 ['assignee missing',f=>f.context.assignee=null,'intake_blocked'],
 ['not ready',f=>f.context.ready_for_ai=false,'intake_blocked'],
 ['conflict',f=>f.context.conflicts=true,'intake_blocked'],
 ['pending operation',f=>f.state.resume.pending_operations.push('synthetic operation'),'unsafe_retry'],
 ['unsafe retry',f=>f.state.resume.safe_to_retry=false,'unsafe_retry'],
 ['review unknown',f=>f.context.retry_review.confirmed=null,'unsafe_retry'],
 ['last validation failed',f=>f.state.validations[0].status='failed','validation_missing'],
]) test(name,()=>{const f=paused();change(f);const r=checkWorkflow(f);has(r,code);assert.equal(r.resume_decision,'blocked');assert.equal(r.next_stage,null);});
test('same revision cannot silently change plan and invalidate approvals',()=>{const f=paused();f.plan.stages[0].reason='changed';has(checkWorkflow(f),'revision_invalid');});
test('replan cannot bypass pending operations or existing blockers',async()=>{
 const {revised}=await import('./fixtures/build.mjs');const f=revised();f.state.resume.pending_operations=['Synthetic retry'];has(checkWorkflow(f),'unsafe_retry');
 const g=paused();g.state.blockers=[{blocker_id:'pending',reason:'Synthetic',evidence:[],resolution:'Review'}];has(checkWorkflow(g),'state_stopped');
});
