import test from 'node:test';
import assert from 'node:assert/strict';
import {checkTraceability} from '../../tools/workflow-trace/check.mjs';
import {fixture} from './fixtures/build.mjs';
import {has} from './graph.test.mjs';
test('deterministic, immutable, and schema-compatible output projection',()=>{
 const f=fixture(),before=JSON.stringify(f),r=checkTraceability(f);assert.equal(r.status,'pass');assert.equal(JSON.stringify(f),before);assert.deepEqual(checkTraceability(f),r);
 assert.ok(Array.isArray(r.checks));
});
test('workflow integrity is recomputed, not accepted from a cached result',()=>{
 const f=fixture();f.workflowInput.plan.extensions.rule_resolution.input_digest='0'.repeat(64);has(checkTraceability(f),'workflow_invalid');
});
test('past snapshot required at non-draft boundary',()=>{const f=fixture();delete f.workflowInput.previous;has(checkTraceability(f),'workflow_invalid');});
test('High scoped approvals are required and matched to trace nodes',()=>{
 const f=fixture('design_to_implementation','high');assert.equal(checkTraceability(f).status,'pass');f.traceability.nodes=f.traceability.nodes.filter(n=>n.kind!=='approval');has(checkTraceability(f),'approval_invalid');
});
test('current intake/Git/Issue safety failures cannot be ignored as resume-only',()=>{
 for(const mutate of [f=>f.workflowInput.context.assignee=null,f=>f.workflowInput.context.git.clean=false,f=>f.workflowInput.context.issue_updated_at='2027-01-01T00:00:00Z']){const f=fixture();mutate(f);has(checkTraceability(f),'workflow_invalid');}
});
test('approval node links must agree with its actual approval scope',()=>{
 const f=fixture('design_to_implementation','high');f.traceability.links.filter(l=>l.from.startsWith('approval-')).forEach(l=>l.to='req-1');has(checkTraceability(f),'approval_invalid');
});
test('external work and feature references work without Project runtime',()=>{
 const f=fixture();
 for(const x of [f.context,f.traceability,f.workflowInput.plan,f.workflowInput.state,f.workflowInput.context,f.workflowInput.previous.plan,f.workflowInput.previous.state]){x.work_source='external';x.work_id='external-1';delete x.issue_ref;x.project_id='project-1';x.feature_id='feature-1';}
 f.workflowInput.state.issue_updated_at=null;f.workflowInput.previous.state.issue_updated_at=null;f.workflowInput.context.issue_updated_at=null;
 f.traceability.nodes.push({id:'feature-1',kind:'feature',ref:f.context.contract_ref,status:'complete'});f.traceability.links.push({from:'feature-1',to:'ac-1',relation:'references'});
 assert.equal(checkTraceability(f).status,'pass');
});
test('unresolved work must be handed off at completion without replacing required evidence',()=>{
 const f=fixture('completion');f.traceability.nodes.push({id:'question-1',kind:'open_question',ref:f.context.contract_ref,status:'pending'});has(checkTraceability(f),'follow_up_missing');
 f.traceability.nodes.push({id:'follow-1',kind:'follow_up',ref:f.context.contract_ref,status:'complete'});f.traceability.links.push({from:'question-1',to:'follow-1',relation:'follows_up'});assert.equal(checkTraceability(f).status,'pass');
 f.traceability.links=f.traceability.links.filter(l=>l.from!=='test-1');has(checkTraceability(f),'coverage_missing');
});
test('evaluation cannot predate the submitted evidence snapshot',()=>{
 const f=fixture();f.context.evaluated_at='2020-01-01T00:00:00Z';has(checkTraceability(f),'identity_mismatch');
});
test('High API/Infrastructure plan checks API and applicable Gate evidence',async()=>{
 const {finish,event,approval}=await import('../workflow-check/fixtures/build.mjs');const {digest}=await import('../../tools/workflow-rules/resolve.mjs');
 const f=fixture('draft','high');const w=f.workflowInput;
 w.plan.stages.find(s=>s.stage_id==='api').selection='required';w.context.facts.changes_api.value=true;
 w.context.gates.security.applicable=true;w.context.gates.security.evidence=[{kind:'file',target:'docs/quality.md'}];
 for(const id of ['intake','context','requirements','design','api','quality']) finish(w,id);
 for(const s of w.plan.stages.filter(s=>s.selection==='skipped')) event(w,'stage_skipped',s.stage_id);
 approval(w,'design','design');approval(w,'quality','quality');w.state.next_stage='tests';w.previous={plan:structuredClone(w.plan),state:structuredClone(w.state)};
 f.context.boundary='design_to_implementation';
 f.traceability.nodes.push({id:'api-1',kind:'api',ref:{kind:'file',target:'docs/api.yaml'},status:'complete'});f.traceability.links.push({from:'api-1',to:'design-1',relation:'implements'});f.references.push({reference:{kind:'file',target:'docs/api.yaml'},status:'local_verified',digest:digest('synthetic')});
 for(const [i,a] of w.state.approvals.entries()){
  f.traceability.nodes.push({id:'approval-'+i,kind:'approval',ref:a.reference,status:'complete'});f.traceability.links.push({from:'approval-'+i,to:a.approval_type==='quality'?'gate-quality':'design-1',relation:'references'});
  f.context.external_confirmations.push({reference:a.reference,confirmed_by:a.approved_by,confirmed_at:a.approved_at,evidence:[f.context.contract_ref]});f.references.push({reference:a.reference,status:'human_asserted',digest:null});
 }
 assert.equal(checkTraceability(f).status,'pass');f.traceability.nodes.find(n=>n.id==='api-1').status='pending';has(checkTraceability(f),'node_incomplete');
});
test('rule approval required for the next execution boundary cannot be ignored',async()=>{
 const {readFileSync}=await import('node:fs');const {parseYaml}=await import('../../tools/workflow-rules/load.mjs');const {resolveRules}=await import('../../tools/workflow-rules/resolve.mjs');const {projectPlan}=await import('../../tools/workflow-rules/plan.mjs');
 const f=fixture('design_to_implementation');const w=f.workflowInput;
 const rule=parseYaml(readFileSync(new URL('../workflow-rules/fixtures/conditional.yaml',import.meta.url),'utf8'));w.ruleInput.rules.push(rule);w.ruleInput.context.technologies=['node'];w.plan=projectPlan(w.plan,resolveRules(w.ruleInput),w.ruleInput);w.previous.plan=structuredClone(w.plan);
 has(checkTraceability(f),'approval_invalid');
});
test('manifest checks version, unknown fields, empty authority and status boundaries',async()=>{
 const {readFileSync}=await import('node:fs');const cases=JSON.parse(readFileSync(new URL('./cases.json',import.meta.url),'utf8'));assert.equal(new Set(cases.map(c=>c.id)).size,cases.length);
 for(const c of cases){const f=fixture();let parent=f;for(const key of c.path.slice(0,-1)) parent=parent[key];parent[c.path.at(-1)]=c.value;has(checkTraceability(f),c.code);}
 for(const input of [null,{}, {context:null}]) assert.equal(checkTraceability(input).status,'blocked');
});
