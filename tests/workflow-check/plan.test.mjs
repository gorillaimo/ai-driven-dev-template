import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWorkflow } from '../../tools/workflow-check/check.mjs';
import { fixture } from './fixtures/build.mjs';
export function has(result, code) { assert.ok(result.diagnostics.some(d => d.code === code), JSON.stringify(result)); }
test('initial Low plan is valid and proposes intake without mutation', () => {
 const f = fixture(), before = JSON.stringify(f), r = checkWorkflow(f);
 assert.equal(r.status, 'pass'); assert.equal(r.next_stage, 'intake'); assert.equal(JSON.stringify(f), before);
 assert.deepEqual(checkWorkflow(f), r); assert.equal(r.checks.find(c=>c.check_id==='append_only').status,'not_evaluated');
});
for (const [name, mutate, code] of [
 ['mandatory missing', f=>f.plan.stages.splice(0,1), 'required_stage'],
 ['mandatory skip', f=>f.plan.stages[0].selection='skipped', 'required_stage'],
 ['unknown fact', f=>f.context.facts.changes_api.value=null, 'unknown_fact'],
 ['duplicate', f=>f.plan.stages.push(structuredClone(f.plan.stages[0])), 'duplicate_stage'],
 ['unknown dependency', f=>f.plan.stages[0].depends_on=['api'], 'skipped_dependency'],
 ['self dependency', f=>f.plan.stages[0].depends_on=['intake'], 'stage_cycle'],
 ['implicit cycle', f=>f.plan.stages[0].depends_on=['handoff'], 'stage_cycle'],
 ['TDD missing tests', f=>{f.context.facts.changes_implementation.value=true;}, 'required_stage'],
 ['rule stale', f=>f.plan.extensions.rule_resolution.input_digest='0'.repeat(64), 'rule_mismatch'],
 ['legacy un-migrated', f=>delete f.plan.extensions.rule_resolution, 'rule_mismatch'],
 ['schema version', f=>f.context.schema_version=2, 'schema_invalid'],
 ['unknown field', f=>f.context.typo=true, 'schema_invalid'],
 ['identity mismatch', f=>f.state.work_id='issue-2', 'identity_mismatch'],
 ['Issue number mismatch', f=>f.context.work_id='issue-2', 'identity_mismatch'],
 ['API required', f=>f.context.facts.changes_api.value=true, 'required_stage'],
]) test(name, ()=>{const f=fixture();mutate(f);has(checkWorkflow(f),code);});
test('Medium feature and bugfix plans retain design and TDD; High requires quality',()=>{
 assert.equal(checkWorkflow(fixture('medium',true)).status,'pass');
 const bug=fixture('medium',true);bug.context.facts.changes_spec.value=false;assert.equal(checkWorkflow(bug).status,'pass');
 const high=fixture('high',true);assert.equal(checkWorkflow(high).status,'pass');high.plan.stages.find(s=>s.stage_id==='quality').selection='skipped';has(checkWorkflow(high),'required_stage');
});
test('external contract and optional Project identifiers remain supported',()=>{
 const f=fixture();for(const x of [f.plan,f.state,f.context]) {x.work_source='external';x.work_id='ticket-1';delete x.issue_ref;x.project_id='example';x.feature_id='feature-1';}
 f.context.issue_updated_at=null;f.state.issue_updated_at=null;assert.equal(checkWorkflow(f).status,'pass');
});
test('required conditional skip needs a human exception for this revision and contract',()=>{
 const f=fixture();f.context.facts.changes_api.value=true;
 const override={stage:'api',plan_revision:1,contract_ref:f.context.contract_ref,reason:'Synthetic contract amendment',approval:{approval_type:'stage-skip',approved_by:'example-user',reference:{kind:'url',target:f.context.issue_ref+'#issuecomment-1'},approved_at:'2026-10-22T00:00:00Z'}};
 f.context.skip_overrides=[override];assert.equal(checkWorkflow(f).checks.find(c=>c.check_id==='plan').status,'pass');
 f.context.required_stages=['api'];has(checkWorkflow(f),'required_stage');
});
test('extra stage approval and selected rule approval are never implicitly granted',async()=>{
 const {paused}=await import('./fixtures/build.mjs');const f=paused();f.plan.stages.find(s=>s.stage_id==='validation').approval_required=true;f.previous.plan=structuredClone(f.plan);
 has(checkWorkflow(f),'approval_missing');
});
test('bad rule input and malformed previous extension block safely without throwing',()=>{
 const f=fixture('medium',true);f.ruleInput=null;assert.equal(checkWorkflow(f).status,'blocked');
 const g=fixture();g.previous={plan:structuredClone(g.plan),state:structuredClone(g.state)};g.previous.state.extensions.workflow_check.revisions=null;has(checkWorkflow(g),'schema_invalid');
});
test('skipped optional stages are not proposed for execution',async()=>{
 const {finish}=await import('./fixtures/build.mjs');const f=fixture();finish(f,'intake');finish(f,'context');f.state.next_stage='validation';
 const r=checkWorkflow(f);assert.equal(r.checks.find(c=>c.check_id==='state').status,'pass');
});
test('manifest checks schema boundaries and unknown observations',async()=>{
 const {readFileSync}=await import('node:fs');const cases=JSON.parse(readFileSync(new URL('./cases.json',import.meta.url),'utf8'));
 assert.equal(new Set(cases.map(c=>c.id)).size,cases.length);
 for(const c of cases){const f=fixture();let parent=f;for(const key of c.path.slice(0,-1)) parent=parent[key];parent[c.path.at(-1)]=c.value;has(checkWorkflow(f),c.code);}
});
test('malformed JSON input shapes return blocked diagnostics',()=>{
 for(const f of [null,{}, {revisionPlans:{}}, {...fixture('medium',true),ruleInput:{rules:[null]}}]) assert.equal(checkWorkflow(f).status,'blocked');
});
