import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseYaml } from '../../tools/workflow-rules/load.mjs';
const read=()=>readFileSync(new URL('../../.github/workflows/workflow-validation.yml',import.meta.url),'utf8');
test('workflow always triggers for PR/main/manual, with no changed-path gaps',()=>{
 const w=parseYaml(read());assert.equal(w.name,'Workflow Validation');assert.deepEqual(Object.keys(w.on).sort(),['pull_request','push','workflow_dispatch']);
 assert.deepEqual(w.on.push.branches,['main']);assert.deepEqual(w.on.pull_request.types,['opened','synchronize','reopened','ready_for_review']);
 assert.ok(!JSON.stringify(w.on).includes('paths'));assert.ok(!JSON.stringify(w.on).includes('pull_request_target'));
});
test('permissions and pinned official actions do not persist credentials or expose secrets',()=>{
 const text=read(),w=parseYaml(text);assert.deepEqual(w.permissions,{contents:'read'});
 const job=w.jobs.validate;assert.equal(job['runs-on'],'ubuntu-latest');assert.equal(job['timeout-minutes'],15);assert.deepEqual(job.strategy.matrix.node,[22,24]);assert.equal(job.strategy['fail-fast'],false);assert.equal(w.concurrency['cancel-in-progress'],true);
 const uses=job.steps.filter(s=>s.uses);assert.equal(uses.length,2);for(const s of uses)assert.match(s.uses,/^actions\/(checkout|setup-node)@[0-9a-f]{40}$/);
 const checkout=uses.find(s=>s.uses.startsWith('actions/checkout'));assert.equal(checkout.with['persist-credentials'],false);assert.equal(checkout.with['fetch-depth'],1);assert.equal(checkout.with.ref,undefined);
 assert.ok(!/secrets\.|pull_request_target|continue-on-error|upload-artifact|id-token|cache:|always\(\).*\|\|/.test(text));
 for(const s of job.steps.filter(s=>s.run))assert.ok(!/\$\{\{/.test(s.run),'Fixed shell commands only');
});
test('six locked dependency installations and all existing suites are invoked',()=>{
 const steps=parseYaml(read()).jobs.validate.steps,commands=steps.map(s=>s.run??'').join('\n');
 for(const name of ['rules','check','trace','schema','golden','ci']){
  assert.ok(commands.includes('npm ci --prefix tools/workflow-'+name+' --ignore-scripts --no-audit --no-fund'));
 }
 for(const command of ['node tools/workflow-schema/validate.mjs','npm run test:brownfield --prefix tools/workflow-schema','npm test --prefix tools/workflow-rules','npm test --prefix tools/workflow-check','npm test --prefix tools/workflow-trace','npm test --prefix tools/workflow-golden','npm test --prefix tools/workflow-ci','node tools/workflow-golden/run.mjs --json','node tools/workflow-ci/validate.mjs --json'])assert.ok(commands.includes(command),command);
 assert.ok(!commands.includes('npm ci\n'));assert.ok(!/packages\//.test(commands));
});
test('summary runs after failures and receives structured outcomes without raw content',()=>{
 const steps=parseYaml(read()).jobs.validate.steps,last=steps.at(-1);assert.equal(last.if,'always()');assert.ok(last.run.includes('GITHUB_STEP_SUMMARY'));
 assert.ok(last.env.JOB_STATUS.includes('job.status'));assert.ok(last.env.CI_OUTCOME.includes('steps.artifacts.outcome'));assert.ok(last.env.GOLDEN_OUTCOME.includes('steps.golden.outcome'));
 assert.ok(!/cat .*yaml|toJSON\(github|github\.event\.pull_request\.(title|body|head)/.test(read()));
});
