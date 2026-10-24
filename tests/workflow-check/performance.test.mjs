import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {checkWorkflow} from '../../tools/workflow-check/check.mjs';
import {fixture,finish,approval,stamp,actor,evidence,ids,ref} from './fixtures/build.mjs';
test('12 stages, 1000 events, 10 revisions within five seconds',()=>{
 const f=fixture('medium',true);for(const s of f.plan.stages) s.selection='required';
 f.context.facts.needs_brownfield.value=true;f.context.facts.needs_prototype.value=true;f.context.facts.changes_api.value=true;f.context.gates.security.applicable=true;
 for(let revision=1;revision<=10;revision++){
  finish(f,'intake');finish(f,'context');
  for(let j=0;j<47+(revision===10?5:0);j++) approval(f,'stage','design');
  if(revision===10) break;
  f.revisionPlans.push(structuredClone(f.plan));
  const e={event_id:'event-'+(f.state.history.length+1),event_type:'plan_revised',occurred_at:stamp,actor,stage:null,before:'in_progress',after:'planned',evidence,reason:'Synthetic revision',plan_revision:revision+1};
  f.state.history.push(e);f.state.extensions.workflow_check.revisions.push({event_id:e.event_id,from_revision:revision,to_revision:revision+1,restart_stage:'intake',invalidated_stages:ids,invalidated_artifacts:[]});
  f.plan.revision++;f.state.plan_revision++;f.state.status='planned';f.state.current_stage=null;f.state.last_completed_stage=null;for(const s of f.state.stages) s.status='pending';
 }
 f.state.next_stage='brownfield';f.state.validations.push({validation_id:'boundary',status:'passed',reference:ref,executed_at:stamp});f.state.extensions.workflow_check.validation_scopes.push({validation_id:'boundary',plan_revision:10,stage:'context'});
 f.previous={plan:structuredClone(f.plan),state:structuredClone(f.state)};
 assert.equal(f.state.history.length,1000);
 const start=performance.now(),r=checkWorkflow(f),elapsed=performance.now()-start;
 assert.equal(r.status,'pass',JSON.stringify(r.diagnostics));assert.ok(elapsed<5000);console.log('12 stages/1000 events/10 revisions: '+elapsed.toFixed(2)+'ms');
});
