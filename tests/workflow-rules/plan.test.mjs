import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveRules} from '../../tools/workflow-rules/resolve.mjs';
import {parseYaml,loadRules} from '../../tools/workflow-rules/load.mjs';
import {projectPlan} from '../../tools/workflow-rules/plan.mjs';
const root=new URL('../../',import.meta.url).pathname;
test('plan v1 compatible projection, preserves source; rejects blocked and stale result',()=>{
 const plan=parseYaml(readFileSync(root+'.ai-workflow/templates/issue/v1/plan.yaml','utf8'));
 const input={...loadRules(root),context:{schema_version:1,risk:'low',areas:[],technologies:[],data_types:[]},optIns:[]};
 const result=resolveRules(input);const before=structuredClone(plan);const projected=projectPlan(plan,result,input);
 assert.deepEqual(plan,before);assert.equal(projected.schema_version,1);assert.equal(projected.extensions.rule_resolution.status,'pass');assert.equal(projected.resolved_rules[0].rule_id,'legacy');
 assert.throws(()=>projectPlan(plan,{...result,status:'blocked'},input));
 assert.throws(()=>projectPlan(plan,result,{...input,context:{...input.context,risk:'high'}}));
 assert.throws(()=>projectPlan(plan,{...result,order:[]},input));
});
test('risk mismatch and unvalidated extensions cannot authorize projection',()=>{
 const plan=parseYaml(readFileSync(root+'.ai-workflow/templates/issue/v1/plan.yaml','utf8'));
 const input={...loadRules(root),context:{schema_version:1,risk:'high'},optIns:[]};
 assert.throws(()=>projectPlan(plan,resolveRules(input),input),/risk/);
 const low={...input,context:{schema_version:1,risk:'low'}};const result=resolveRules(low);
 assert.throws(()=>projectPlan({...plan,schema_version:2},result,low));
 const projected=projectPlan({...plan,extensions:{custom:'preserved'}},result,low);
 assert.equal(projected.extensions.custom,'preserved');assert.equal(projected.revision,plan.revision);
});
