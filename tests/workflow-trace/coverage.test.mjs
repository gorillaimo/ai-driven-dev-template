import test from 'node:test';
import assert from 'node:assert/strict';
import {checkTraceability} from '../../tools/workflow-trace/check.mjs';
import {fixture,boundaries} from './fixtures/build.mjs';
import {has} from './graph.test.mjs';
for(const b of boundaries) test('normal '+b,()=>{const f=fixture(b);const r=checkTraceability(f);assert.equal(r.status,'pass',JSON.stringify(r.diagnostics));});
test('Low document path may skip requirement/design/tests',()=>assert.equal(checkTraceability(fixture('implementation_to_pr','low',false)).status,'pass'));
for(const [name,mutate,code] of [
 ['missing design',f=>f.traceability.links=f.traceability.links.filter(l=>l.from!=='design-1'),'coverage_missing'],
 ['missing test',f=>f.traceability.links=f.traceability.links.filter(l=>l.from!=='test-1'),'coverage_missing'],
 ['unvalidated change',f=>f.traceability.links=f.traceability.links.filter(l=>l.from!=='validation-1'),'coverage_missing'],
 ['failed validation',f=>{f.workflowInput.state.validations[0].status='failed';f.workflowInput.previous.state.validations[0].status='failed';},'validation_invalid'],
 ['revision mismatch',f=>f.context.plan_revision=2,'identity_mismatch'],
 ['identity mismatch',f=>f.traceability.work_id='issue-2','identity_mismatch'],
 ['fake cached pass',f=>{f.traceability.checks=[{check_id:'cached',boundary:'implementation_to_pr',result:'pass',references:[],reason:'Old result'}];f.traceability.links=[];},'coverage_missing'],
]) test(name,()=>{const f=fixture();mutate(f);has(checkTraceability(f),code);});
test('pending future design is allowed only at entry to design',()=>{
 const f=fixture('requirements_to_design');f.references.find(r=>r.reference.target==='docs/design.md').status='missing';f.references.find(r=>r.reference.target==='docs/design.md').digest=null;assert.equal(checkTraceability(f).status,'pass');
 f.context.boundary='design_to_implementation';has(checkTraceability(f),'node_incomplete');
});
test('completion does not treat a follow-up as completion of a required AC',()=>{
 const f=fixture('completion');f.traceability.nodes[0].status='pending';has(checkTraceability(f),'node_incomplete');
});
test('validation must cover each test and change, not just reach the same AC',()=>{
 const f=fixture();f.traceability.links=f.traceability.links.filter(l=>!(l.from==='validation-1'&&l.to==='test-1'));has(checkTraceability(f),'coverage_missing');
});
test('a reference-only attachment does not hide a typed orphan',()=>{
 const f=fixture();f.traceability.nodes.push({id:'orphan-req',kind:'requirement',ref:{kind:'file',target:'docs/requirements.md'},status:'complete'});f.traceability.links.push({from:'orphan-req',to:'req-1',relation:'references'});has(checkTraceability(f),'orphan_node');
});
test('late validation scope must refer to verification of this boundary',()=>{
 const f=fixture();f.workflowInput.state.extensions.workflow_check.validation_scopes[0].stage='context';f.workflowInput.previous.state.extensions.workflow_check.validation_scopes[0].stage='context';has(checkTraceability(f),'validation_invalid');
});
test('a later failed validation cannot be hidden behind an earlier passed record',()=>{
 const f=fixture();for(const state of [f.workflowInput.state,f.workflowInput.previous.state]){
  const v=structuredClone(state.validations[0]);v.validation_id='run-2';v.status='failed';state.validations.push(v);state.extensions.workflow_check.validation_scopes.push({validation_id:'run-2',plan_revision:1,stage:'validation'});
 }has(checkTraceability(f),'validation_invalid');
});
