import { canonical } from 'workflow-rules/resolve';
export const stages = ['intake','context','brownfield','prototype','requirements','design','api','quality','tests','implementation','validation','handoff'];
const fixed = ['intake','context','validation','handoff'];
export const same = (a, b) => canonical(a) === canonical(b);
export const ext = state => state.extensions?.workflow_check;

export function skipAllowed(stage, plan, context) {
  if (fixed.includes(stage) || context.required_stages.includes(stage)) return false;
  return context.skip_overrides.some(override => override.stage === stage &&
    override.plan_revision === plan.revision && same(override.contract_ref, context.contract_ref) &&
    override.approval.approval_type === 'stage-skip' && override.reason.trim());
}

export function inspectPlan(plan, context, add) {
  const byId = new Map();
  for (const stage of plan.stages) {
    if (byId.has(stage.stage_id)) add('duplicate_stage', 'plan/stages', stage.stage_id);
    byId.set(stage.stage_id, stage);
    if (!stage.reason.trim() || !stage.evidence.length) add('required_stage', 'plan/stages', stage.stage_id);
  }
  for (const [name, fact] of Object.entries(context.facts)) {
    if (fact.value === null) add('unknown_fact', 'context/facts/' + name);
  }
  for (const [name, gate] of Object.entries(context.gates)) {
    if (gate.applicable === null) add('unknown_fact', 'context/gates/' + name);
  }
  const facts = context.facts;
  const required = new Set([...fixed, ...context.required_stages]);
  for (const [id, fact] of [['brownfield','needs_brownfield'],['prototype','needs_prototype'],['requirements','changes_spec'],['api','changes_api']]) {
    if (facts[fact].value === true) required.add(id);
  }
  if (context.risk !== 'low' || facts.minor_change.value === false) required.add('design');
  if (context.risk === 'high' || Object.values(context.gates).some(gate => gate.applicable === true)) required.add('quality');
  if (facts.changes_implementation.value === true) { required.add('tests'); required.add('implementation'); }
  for (const id of required) {
    const stage = byId.get(id);
    if (!stage || (stage.selection !== 'required' && !(stage.selection === 'skipped' && skipAllowed(id, plan, context)))) {
      add('required_stage', 'plan/stages', id);
    }
  }
  const graph = new Map(plan.stages.map(stage => [stage.stage_id, new Set(stage.depends_on)]));
  const selected = id => byId.has(id) && byId.get(id).selection !== 'skipped';
  const edge = (id, dep) => { if (selected(id) && selected(dep)) graph.get(id).add(dep); };
  for (const id of byId.keys()) if (id !== 'intake') edge(id, 'intake');
  for (const id of byId.keys()) if (!['intake','context'].includes(id)) edge(id, 'context');
  edge('design','requirements');
  for (const id of ['design','api','quality']) edge('tests',id);
  edge('implementation','tests');
  for (const id of byId.keys()) if (!['validation','handoff'].includes(id)) edge('validation',id);
  edge('handoff','validation');
  for (const [id, deps] of graph) for (const dep of deps) {
    if (!byId.has(dep)) add('dependency_unknown','plan/stages',id);
    else if (!selected(dep) && selected(id)) add('skipped_dependency','plan/stages',id);
  }
  // Kahn's algorithm also checks cycles formed by implicit boundary edges.
  const remaining = new Set(graph.keys());
  while (remaining.size) {
    const ready = [...remaining].filter(id => [...graph.get(id)].every(dep => !remaining.has(dep)));
    if (!ready.length) { add('stage_cycle','plan/stages'); break; }
    for (const id of ready) remaining.delete(id);
  }
  return { byId, graph };
}

export function nextStage(plan, statuses, graph) {
  for (const id of stages) {
    const stage = plan.stages.find(item => item.stage_id === id);
    if (!stage || stage.selection === 'skipped' || ['completed','skipped'].includes(statuses.get(id))) continue;
    if (statuses.get(id) !== 'pending') continue;
    if ([...graph.get(id)].every(dep => ['completed','skipped'].includes(statuses.get(dep)))) return id;
  }
  return null;
}

export function hasApproval(state, plan, context, stage, type, until = Infinity, ruleId) {
  return (ext(state)?.approval_scopes ?? []).some(scope => {
    if (scope.stage !== stage || scope.plan_revision !== plan.revision || !same(scope.contract_ref, context.contract_ref) || scope.rule_id !== ruleId) return false;
    const approval = state.approvals.find(a => same(a.reference, scope.reference) && a.approval_type === type);
    const index = state.history.findIndex(e => e.event_id === scope.event_id);
    const event = state.history[index];
    return approval && index >= 0 && index < until && event.event_type === 'approval_recorded' &&
      event.actor.actor_type === 'human' && event.actor.actor_ref === approval.approved_by &&
      event.evidence.some(ref => same(ref, scope.reference)) &&
      Date.parse(approval.approved_at) <= Date.parse(event.occurred_at);
  });
}

export function checkApprovals(state, plan, context, stageId, ruleInput, add, until = Infinity, eventId = null) {
  const required = [];
  if (plan.stages.find(s => s.stage_id === stageId)?.approval_required || context.approval_stages.includes(stageId)) required.push([stageId,'stage']);
  if (['tests','implementation'].includes(stageId)) {
    if (plan.risk === 'high') required.push(['design','design'],['quality','quality']);
    for (const rule of Array.isArray(ruleInput?.rules) ? ruleInput.rules : []) {
      if (rule?.approval_required && plan.resolved_rules.some(ref => ref.rule_id === rule.rule_id)) required.push([stageId,'rule',rule.rule_id]);
    }
  }
  for (const [stage, type, rule] of required) {
    if (!hasApproval(state, plan, context, stage, type, until, rule)) add('approval_missing','state/approvals',stageId,eventId);
  }
}
