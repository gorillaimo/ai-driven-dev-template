import { readFileSync } from 'node:fs';
import { parseYaml } from '../../tools/workflow-rules/load.mjs';
import { canonical, digest } from '../../tools/workflow-rules/resolve.mjs';

export const clone = value => structuredClone(value);
export const ref = { kind: 'url', target: 'https://github.com/example/project/issues/1#issuecomment-1' };
export const actor = { actor_type: 'human', actor_ref: 'example-user' };
export const stamp = '2026-10-27T00:00:00Z';
export const approval = { approval_type: 'project_replan', approved_by: 'example-user', reference: ref, approved_at: stamp };
export function feature(id, dependencies = [], areas = [], priority = 1) {
  return { feature_id: id, source_ref: { kind: 'file', target: 'docs/system-context.md', fragment: 'feature-' + id },
    depends_on: dependencies.map(feature_id => ({ feature_id, reason: 'A reviewed contract is required.' })),
    area_ids: areas, planned_priority: priority, constraints: [], issue_refs: [] };
}
export function bind(input) {
  const c = input.context;
  Object.assign(c, { project_id: input.project.project_id, project_revision: input.project.revision,
    plan_revision: input.deliveryPlan.revision, project_digest: digest(canonical(input.project)), plan_digest: digest(canonical(input.deliveryPlan)) });
  return input;
}
export function input(features = [feature('a')]) {
  const project = parseYaml(readFileSync(new URL('./fixtures/project.yaml', import.meta.url), 'utf8'));
  const deliveryPlan = { schema_version: 1, artifact_kind: 'delivery_plan', project_id: project.project_id,
    revision: 1, updated_at: stamp, updated_by: clone(actor), features, revision_history: [] };
  return bind({ project, deliveryPlan, context: { schema_version: 1, observed_at: stamp,
    recorded_by: clone(actor), source: clone(ref), feature_facts: features.map(f => ({feature_id:f.feature_id,state:'planned'})),
    constraint_facts: [], replan_decisions: [] } });
}
export function state(i, id, value) {
  Object.assign(i.context.feature_facts.find(f => f.feature_id === id), { state:value, evidence:clone(ref) });
  return i;
}
export function revised(old, features, affected, waves) {
  const i = clone(old); delete i.previous;
  i.previous = clone(old); delete i.previous.previous;
  i.deliveryPlan.revision++;
  i.deliveryPlan.features = features;
  i.deliveryPlan.revision_history.push({ revision:i.deliveryPlan.revision, reason:'Reviewed dependency change.',
    approval:clone(approval), affected_feature_ids:affected, invalidated_waves:waves });
  i.context.feature_facts = features.map(f => clone(old.context.feature_facts.find(v => v.feature_id === f.feature_id) ?? {feature_id:f.feature_id,state:'planned'}));
  return bind(i);
}
export function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
