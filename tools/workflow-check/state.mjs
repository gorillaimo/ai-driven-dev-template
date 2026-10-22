import { same, ext, inspectPlan, nextStage, checkApprovals } from './plan.mjs';

export function validationPassed(state, revision, stage, until = Infinity) {
  return (ext(state)?.validation_scopes ?? []).some(scope => {
    if (scope.plan_revision !== revision || scope.stage !== stage) return false;
    const validation = state.validations.find(v => v.validation_id === scope.validation_id);
    return validation?.status === 'passed' && validation.executed_at !== null && Date.parse(validation.executed_at) <= until;
  });
}

export function semanticPlan(plan) {
  const { updated_at, updated_by, ...rest } = plan;
  return rest;
}

export function inspectState(input, graph, add, validate) {
  const { plan, state, context, previous, ruleInput } = input;
  const extension = ext(state);
  const plans = new Map();
  for (const candidate of [...(input.revisionPlans ?? []), ...(previous ? [previous.plan] : []), plan]) {
    if (!validate('plan', candidate)) { add('schema_invalid','revisionPlans'); continue; }
    if (plans.has(candidate.revision) && !same(semanticPlan(plans.get(candidate.revision)), semanticPlan(candidate))) {
      add('revision_invalid','revisionPlans');
    }
    if (!same(candidate.work_id,plan.work_id) || candidate.work_source!==plan.work_source || candidate.issue_ref!==plan.issue_ref) add('identity_mismatch','revisionPlans');
    inspectPlan(candidate, { ...context, risk: candidate.risk }, add);
    plans.set(candidate.revision, candidate);
  }
  const uniqueBindings = (items, key, code, path) => {
    const keys = items.map(key);
    if (new Set(keys).size !== keys.length) add(code,path);
  };
  uniqueBindings(state.approvals, a => JSON.stringify([a.approval_type,a.reference]), 'approval_invalid','state/approvals');
  uniqueBindings(extension.approval_scopes, a => JSON.stringify([a.reference,a.stage,a.plan_revision,a.rule_id]), 'approval_invalid','state/extensions/workflow_check/approval_scopes');
  uniqueBindings(extension.validation_scopes, a => a.validation_id, 'validation_missing','state/extensions/workflow_check/validation_scopes');
  uniqueBindings(extension.revisions, a => a.event_id, 'revision_invalid','state/extensions/workflow_check/revisions');
  for (const scope of extension.approval_scopes) {
    const approval = state.approvals.find(a=>same(a.reference,scope.reference));
    const event = state.history.find(e=>e.event_id===scope.event_id);
    if (!plans.get(scope.plan_revision)?.stages.some(s=>s.stage_id===scope.stage) ||
      !approval || !event || event.event_type!=='approval_recorded' ||
      event.actor.actor_type!=='human' || event.actor.actor_ref!==approval.approved_by ||
      !event.evidence.some(ref=>same(ref,scope.reference)) ||
      Date.parse(approval.approved_at)>Date.parse(event.occurred_at)) add('approval_invalid','state/approvals',scope.stage,scope.event_id);
  }
  for (const scope of extension.validation_scopes) {
    const validation=state.validations.find(v=>v.validation_id===scope.validation_id);
    if (!validation || !plans.get(scope.plan_revision)?.stages.some(s=>s.stage_id===scope.stage) ||
      (validation.executed_at && Date.parse(validation.executed_at)>Date.parse(state.updated_at))) add('validation_missing','state/validations',scope.stage);
  }
  for (const detail of extension.revisions) {
    if (!state.history.some(e=>e.event_id===detail.event_id && e.event_type==='plan_revised')) add('revision_invalid','state/extensions/workflow_check/revisions');
  }
  if (state.plan_revision !== plan.revision) add('revision_invalid','state/plan_revision');
  if (previous) {
    if (!validate('state', previous.state) || !validate('plan', previous.plan)) {
      add('schema_invalid','previous');
    } else {
      const previousGraph = inspectPlan(previous.plan,{...context,risk:previous.plan.risk},()=>{}).graph;
      inspectState({ ...input, plan: previous.plan, state: previous.state, previous: undefined,
        revisionPlans: (input.revisionPlans ?? []).filter(p=>p.revision<previous.plan.revision) }, previousGraph,
        (code,path,stage,event)=>add(code,'previous/'+path,stage,event),validate);
      const old = previous.state.history;
      if (!same(old, state.history.slice(0, old.length))) add('history_rewritten','state/history');
      if (plan.revision < previous.plan.revision ||
        (plan.revision === previous.plan.revision && !same(semanticPlan(plan), semanticPlan(previous.plan)))) add('revision_invalid','plan/revision');
      // Existing approval/validation evidence and bindings are also append-only.
      for (const key of ['approvals','validations']) {
        if (!same(previous.state[key], state[key].slice(0, previous.state[key].length))) add('history_rewritten','state/' + key);
      }
      for (const key of ['approval_scopes','validation_scopes','revisions']) {
        const oldBindings = ext(previous.state)?.[key] ?? [];
        if (!same(oldBindings, (extension?.[key] ?? []).slice(0, oldBindings.length))) add('history_rewritten','state/extensions/workflow_check/' + key);
      }
    }
  }
  const stateIds = state.stages.map(s => s.stage_id);
  if (new Set(stateIds).size !== stateIds.length) add('duplicate_stage','state/stages');
  if (!same([...new Set(stateIds)].sort(), [...new Set(plan.stages.map(s=>s.stage_id))].sort())) add('identity_mismatch','state/stages');
  if (state.stages.filter(s=>s.status === 'in_progress').length > 1) add('parallel_stages','state/stages');

  let revision = 1, currentPlan = plans.get(1);
  if (!currentPlan) { add('revision_missing','revisionPlans'); currentPlan = plan; }
  let status = 'planned', current = null, last = null, planned = false;
  let statuses = new Map(currentPlan.stages.map(s=>[s.stage_id,'pending']));
  let currentGraph = inspectPlan(currentPlan, context, () => {}).graph;
  const seen = new Set(), completionOrder = [];
  let lastTime = -Infinity;
  for (let index = 0; index < state.history.length; index++) {
    const e = state.history[index], path = 'state/history/' + index;
    const bad = code => add(code, path, e.stage, e.event_id);
    if (seen.has(e.event_id)) bad('duplicate_event');
    seen.add(e.event_id);
    const time = Date.parse(e.occurred_at);
    if (time < lastTime || time > Date.parse(state.updated_at)) bad('event_time');
    lastTime = time;
    if (['completed','cancelled'].includes(status)) { bad('invalid_transition'); continue; }
    if (e.event_type === 'work_planned') {
      if (planned || index !== 0 || e.stage !== null || e.before !== null || e.after !== 'planned') bad('invalid_transition');
      if (e.plan_revision !== undefined && e.plan_revision !== 1) bad('revision_invalid');
      planned = true;
      continue;
    }
    if (!planned) bad('invalid_transition');
    if (e.event_type === 'plan_revised') {
      const detail = extension?.revisions.find(r=>r.event_id === e.event_id);
      const nextPlan = plans.get(e.plan_revision);
      if (!detail || !nextPlan) { bad('revision_missing'); continue; }
      if (e.stage !== null || e.before !== status || e.after !== 'planned' || !e.reason?.trim() ||
        e.plan_revision !== revision + 1 || detail.from_revision !== revision || detail.to_revision !== e.plan_revision) bad('revision_invalid');
      const newGraph = inspectPlan(nextPlan, context, () => {}).graph;
      const invalidated = new Set([detail.restart_stage]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const [id, deps] of [...currentGraph, ...newGraph]) if (!invalidated.has(id) && [...deps].some(d=>invalidated.has(d))) {
          invalidated.add(id); changed = true;
        }
      }
      if ((current !== null && !invalidated.has(current)) || !statuses.has(detail.restart_stage) || !same([...invalidated].sort(), [...detail.invalidated_stages].sort())) bad('revision_invalid');
      const requiredArtifacts = currentPlan.stages.filter(s=>invalidated.has(s.stage_id)).flatMap(s=>s.artifacts);
      if (requiredArtifacts.some(ref=>!detail.invalidated_artifacts.some(r=>same(r,ref)))) bad('revision_invalid');
      for (const stage of nextPlan.stages) {
        const oldStage = currentPlan.stages.find(s=>s.stage_id === stage.stage_id);
        if (!same(oldStage, stage) && !invalidated.has(stage.stage_id)) bad('revision_invalid');
      }
      statuses = new Map(nextPlan.stages.map(s=>[s.stage_id, invalidated.has(s.stage_id) ? 'pending' : statuses.get(s.stage_id) ?? 'pending']));
      currentPlan = nextPlan; currentGraph = newGraph; revision = e.plan_revision;
      current = null; status = 'planned';
      last = [...completionOrder].reverse().find(id=>statuses.get(id)==='completed') ?? null;
      continue;
    }
    if (e.plan_revision !== undefined && e.plan_revision !== revision) bad('revision_invalid');
    if (e.event_type.startsWith('stage_')) {
      if (!statuses.has(e.stage) || !['planned','in_progress'].includes(status)) { bad('invalid_transition'); continue; }
      const before = statuses.get(e.stage), stage = currentPlan.stages.find(s=>s.stage_id === e.stage);
      const target = {stage_started:'in_progress',stage_completed:'completed',stage_skipped:'skipped'}[e.event_type];
      if (e.before !== before || e.after !== target ||
        (e.event_type === 'stage_completed' ? before !== 'in_progress' : before !== 'pending')) bad('invalid_transition');
      if (e.event_type === 'stage_started') {
        if (current !== null) bad('parallel_stages');
        if (stage.selection === 'skipped') bad('invalid_transition');
        if ([...currentGraph.get(e.stage)].some(dep=>statuses.get(dep)!=='completed')) bad('dependency_incomplete');
        checkApprovals(state, currentPlan, context, e.stage, ruleInput, add, index, e.event_id);
        current = e.stage; status = 'in_progress';
      } else if (e.event_type === 'stage_completed') {
        if (current !== e.stage) bad('invalid_transition');
        current = null; last = e.stage; completionOrder.push(e.stage);
      } else {
        if (stage.selection !== 'skipped') bad('invalid_transition');
        const override = context.skip_overrides.find(o=>o.stage===e.stage && o.plan_revision===revision);
        if (override && (e.actor.actor_type!=='human' || e.actor.actor_ref!==override.approval.approved_by ||
          !e.evidence.some(ref=>same(ref,override.approval.reference)) || Date.parse(override.approval.approved_at)>time)) bad('approval_invalid');
      }
      statuses.set(e.stage, target);
      continue;
    }
    if (e.stage !== null || e.before !== status) bad('invalid_transition');
    const allowed = {
      approval_requested: ['in_progress'], approval_recorded: ['awaiting_approval'],
      work_paused: ['in_progress'], work_resumed: ['paused','blocked','failed','awaiting_approval'],
      work_blocked: ['planned','in_progress','awaiting_approval','paused','failed'],
      work_failed: ['planned','in_progress','awaiting_approval','paused','blocked'],
      work_cancelled: ['planned','in_progress','awaiting_approval','paused','blocked','failed'],
      work_completed: ['in_progress'],
    };
    const targets = {approval_requested:'awaiting_approval',approval_recorded:'in_progress',work_paused:'paused',work_resumed:'in_progress',work_blocked:'blocked',work_failed:'failed',work_cancelled:'cancelled',work_completed:'completed'};
    if (!allowed[e.event_type]?.includes(status) || e.after !== targets[e.event_type]) bad('invalid_transition');
    if (['approval_requested','approval_recorded','work_paused','work_completed'].includes(e.event_type) && current !== null) bad('invalid_transition');
    if (e.event_type === 'approval_recorded') {
      const scopes = extension?.approval_scopes.filter(s=>s.event_id === e.event_id) ?? [];
      if (e.actor.actor_type !== 'human' || !scopes.length || scopes.some(scope => {
        const a = state.approvals.find(a=>same(a.reference,scope.reference));
        return !a || a.approved_by !== e.actor.actor_ref || !e.evidence.some(ref=>same(ref,a.reference)) || Date.parse(a.approved_at)>time || scope.plan_revision !== revision;
      })) bad('approval_invalid');
    }
    if (e.event_type === 'work_completed') {
      if ([...statuses.values()].some(s=>!['completed','skipped'].includes(s)) || state.blockers.length) bad('history_mismatch');
      if (!validationPassed(state, revision, 'validation', time)) bad('validation_missing');
    }
    if (['work_blocked','work_failed','work_cancelled'].includes(e.event_type) && current !== null) {
      statuses.set(current,e.event_type === 'work_failed' ? 'failed' : 'blocked');
      current = null;
    }
    status = targets[e.event_type] ?? status;
  }
  if (!state.history.length && (state.status !== 'planned' || plan.revision !== 1)) add('history_mismatch','state/history');
  if (revision !== plan.revision) add('revision_invalid','state/plan_revision');
  if (state.status !== status || state.current_stage !== current || state.last_completed_stage !== last ||
    state.stages.some(s=>statuses.get(s.stage_id)!==s.status)) add('history_mismatch','state');
  if (state.status === 'blocked' && !state.blockers.length) add('blocker_missing','state/blockers');
  if (state.status === 'failed' && !state.failure_reason?.trim()) add('failure_reason_missing','state/failure_reason');
  for (const key of ['validation_id']) {
    if (new Set(state.validations.map(v=>v[key])).size !== state.validations.length) add('history_mismatch','state/validations');
  }
  const terminal = ['completed','cancelled'].includes(state.status);
  const expected = terminal || current !== null ? null : nextStage(plan,statuses,graph);
  if (state.next_stage !== expected) add('next_stage_mismatch','state/next_stage');
  return { statuses, current, last, expected, terminal };
}
