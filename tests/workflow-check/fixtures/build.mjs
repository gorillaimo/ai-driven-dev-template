import { readFileSync } from 'node:fs';
import { loadRules, parseYaml } from '../../../tools/workflow-rules/load.mjs';
import { resolveRules } from '../../../tools/workflow-rules/resolve.mjs';
import { projectPlan } from '../../../tools/workflow-rules/plan.mjs';
export const root = new URL('../../../', import.meta.url).pathname;
export const stamp = '2026-10-23T00:00:00Z';
export const actor = { actor_type: 'human', actor_ref: 'example-user' };
export const ref = { kind: 'url', target: 'https://github.com/example/project/issues/1' };
export const ids = ['intake','context','brownfield','prototype','requirements','design','api','quality','tests','implementation','validation','handoff'];
export const evidence = [ref];
export function fixture(risk = 'low', feature = false) {
  let plan = parseYaml(readFileSync(root + '.ai-workflow/templates/issue/v1/plan.yaml', 'utf8'));
  const ruleInput = { ...loadRules(root), context: { schema_version: 1, risk, areas: [], technologies: [], data_types: [] }, optIns: [] };
  plan.risk = risk;
  const required = new Set(['intake','context','validation','handoff', ...(feature ? ['requirements','design','tests','implementation'] : []), ...(risk !== 'low' ? ['design'] : []), ...(risk === 'high' ? ['quality'] : [])]);
  plan.stages = ids.map(stage_id => ({ stage_id, selection: required.has(stage_id) ? 'required' : 'skipped', reason: 'Synthetic decision', evidence, decided_by: actor, depends_on: [], artifacts: [], approval_required: false, validation_methods: ['Synthetic review'] }));
  plan = projectPlan(plan, resolveRules(ruleInput), ruleInput);
  const state = parseYaml(readFileSync(root + '.ai-workflow/templates/issue/v1/state.yaml', 'utf8'));
  state.stages = ids.map(stage_id => ({ stage_id, status: 'pending' }));
  state.updated_at = stamp; state.issue_updated_at = stamp;
  state.resume.safe_to_retry = true;
  state.extensions = { workflow_check: { schema_version: 1, approval_scopes: [], validation_scopes: [], revisions: [] } };
  const fact = value => ({ value, evidence });
  const context = { schema_version: 1, work_id: plan.work_id, work_source: plan.work_source, issue_ref: plan.issue_ref, risk,
    contract_ref: ref, assignee: 'example-user', ready_for_ai: true, issue_updated_at: stamp, conflicts: false,
    git: { ...state.git, clean: true, remote_matches: true },
    facts: { needs_brownfield: fact(false), needs_prototype: fact(false), changes_spec: fact(feature), minor_change: fact(!feature), changes_api: fact(false), changes_implementation: fact(feature) },
    gates: Object.fromEntries(['nfr','security','resiliency'].map(id => [id, { applicable: false, reason: 'Synthetic assessment', evidence }])),
    required_stages: [], approval_stages: [], skip_overrides: [], retry_review: { confirmed: true, evidence },
  };
  return { plan, state, context, ruleInput, revisionPlans: [] };
}
export function event(input, type, stage = null, extra = {}) {
  const { state } = input;
  const before = type.startsWith('stage_') ? state.stages.find(s => s.stage_id === stage).status : state.status;
  const after = { stage_started: 'in_progress', stage_completed: 'completed', stage_skipped: 'skipped', work_paused: 'paused', work_resumed: 'in_progress', work_blocked: 'blocked', work_failed: 'failed', work_cancelled: 'cancelled', work_completed: 'completed', approval_requested: 'awaiting_approval', approval_recorded: 'in_progress' }[type];
  const e = { event_id: 'event-' + (state.history.length + 1), event_type: type, occurred_at: stamp, actor, stage, before, after, evidence, ...extra };
  state.history.push(e);
  if (type.startsWith('stage_')) {
    state.stages.find(s => s.stage_id === stage).status = after;
    if (type === 'stage_started') { state.status = 'in_progress'; state.current_stage = stage; }
    if (type === 'stage_completed') { state.current_stage = null; state.last_completed_stage = stage; }
  } else state.status = e.after;
  return e;
}
export function finish(input, stage) { event(input, 'stage_started', stage); event(input, 'stage_completed', stage); }
export function paused() {
  const f = fixture(); finish(f, 'intake'); finish(f, 'context');
  for (const s of f.plan.stages.filter(s => s.selection === 'skipped')) event(f, 'stage_skipped', s.stage_id);
  f.state.validations.push({ validation_id: 'context-check', status: 'passed', reference: ref, executed_at: stamp });
  f.state.extensions.workflow_check.validation_scopes.push({ validation_id: 'context-check', plan_revision: 1, stage: 'context' });
  f.state.next_stage = 'validation'; event(f, 'work_paused');
  f.previous = { plan: structuredClone(f.plan), state: structuredClone(f.state) };
  return f;
}
export function approval(input, type, stage, rule_id) {
  const reference = { kind: 'url', target: ref.target + '#issuecomment-' + (input.state.approvals.length + 1) };
  const a = { approval_type: type, approved_by: 'example-user', reference, approved_at: stamp };
  event(input, 'approval_requested'); const e = event(input, 'approval_recorded', null, { evidence: [reference] });
  input.state.approvals.push(a);
  input.state.extensions.workflow_check.approval_scopes.push({ reference, plan_revision: input.plan.revision, stage, contract_ref: ref, event_id: e.event_id, ...(rule_id ? { rule_id } : {}) });
}
export function revised() {
 const f=paused(), oldPlan=structuredClone(f.plan);
 const e={event_id:'event-'+(f.state.history.length+1),event_type:'plan_revised',occurred_at:stamp,actor,stage:null,before:'paused',after:'planned',evidence,reason:'Synthetic restart',plan_revision:2};
 f.state.history.push(e);f.plan.revision=2;f.state.plan_revision=2;f.state.status='planned';
 f.state.extensions.workflow_check.revisions.push({event_id:e.event_id,from_revision:1,to_revision:2,restart_stage:'validation',invalidated_stages:['validation','handoff'],invalidated_artifacts:[]});
 f.state.validations.push({validation_id:'context-review-2',status:'passed',reference:ref,executed_at:stamp});
 f.state.extensions.workflow_check.validation_scopes.push({validation_id:'context-review-2',plan_revision:2,stage:'context'});
 f.revisionPlans=[oldPlan];return f;
}
