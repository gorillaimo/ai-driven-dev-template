// P6: synthetic authority is deliberately distinct from actual Git/Docker checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fixture as github, hash, time, fakeApi } from '../workflow-github/fixture.mjs';
import { createAuthorityProvider, verifyRunAuthorization } from '../../tools/workflow-github/auth.mjs';
import { planIntegration, validateIntegrationArtifact, summarizeIntegration, projectIntegrationResult, freshIntegration } from '../../tools/workflow-integration/core.mjs';
import { createIntegrationAuthority, createSyntheticIntegrationExecutor, createDockerIntegrationExecutor, openIntegrationController } from '../../tools/workflow-integration/controller.mjs';
import { createIntegrationJournal } from '../../tools/workflow-github/journal.mjs';
import { executeIntegrationSummaryOperation } from '../../tools/workflow-github/broker.mjs';

const digest = b => createHash('sha256').update(b).digest('hex');
const now = () => time;
const image = process.env.WORKFLOW_INTEGRATION_TEST_IMAGE ?? 'sha256:' + 'e'.repeat(64);
function input(n = 2) {
  const profile = {
    schema_version: 1, artifact_kind: 'integration-profile', artifact_id: 'integration-profile', revision: 1,
    repository: 'example/synthetic', repository_id: 1, owner_id: 7, base_branch: 'main', image,
    reviewed_at: '2026-11-04T00:00:00Z', expires_at: '2026-11-05T00:00:00Z',
    scope: ['src'], required_categories: ['integration'],
    checks: [{ id: 'test-app', category: 'integration', executable: 'node', argv: ['--test', 'src/app.test.cjs'], timeout_seconds: 30, minimum_tests: 1, ac_refs: ['AC2'] }],
    limits: { max_prs: 10, max_cases: 11, max_commands: 100, command_seconds: 1800, run_seconds: 21600, cleanup_seconds: 600, cpus: 2, memory_mib: 2048, pids: 128, scratch_mib: 256, bundle_bytes: 209715200, source_files: 10000, file_bytes: 10485760, source_bytes: 104857600, log_bytes: 10485760, artifact_bytes: 104857600, run_artifact_bytes: 1073741824, summary_bytes: 32768 },
  };
  const request = {
    schema_version: 1, artifact_kind: 'integration-request', run_id: 'run-1', repository: profile.repository, repository_id: 1,
    profile_digest: hash(profile), main_sha: '2'.repeat(40), bundle_digest: 'd'.repeat(64),
    targets: Array.from({length:n}, (_, i) => ({issue_number: i+1, pr_number: i+11, head_sha: String(i+3).repeat(40), plan_digest: String(i+5).repeat(64), depends_on: []})),
  };
  return {profile, request};
}
const plan = i => planIntegration(i).plan;
const check = (k,v) => validateIntegrationArtifact(k,v).valid;
function changeProfile(i, fn) { fn(i.profile); i.request.profile_digest=hash(i.profile); }

test('AC3: deterministic dependency closures, ordered full set, no subset/permutation guarantee', () => {
  const i=input(3); i.request.targets[2].depends_on=[1];
  const r=planIntegration(i);
  assert.equal(r.status,'planned'); assert.equal(r.authority,false);
  assert.deepEqual(r.plan.order,[1,2,3]);
  assert.deepEqual(r.plan.cases.map(c=>c.issue_numbers),[[1],[2],[1,3],[1,2,3]]);
  assert.equal(check('plan',r.plan),true);
  assert(r.plan.not_evaluated.includes('all_subsets_and_orders'));
  i.request.order=[2,1,3]; assert.deepEqual(plan(i).order,[2,1,3]);
  i.request.order=[3,1,2]; assert.equal(planIntegration(i).status,'blocked');
});
test('AC3: cycle, missing dependency, duplicate PR, unknown fields and limits are rejected', () => {
  for (const mutate of [
    i=>{i.request.targets[0].depends_on=[2];i.request.targets[1].depends_on=[1];},
    i=>{i.request.targets[0].depends_on=[99];},
    i=>{i.request.targets[1].pr_number=i.request.targets[0].pr_number;},
    i=>{i.request.authority=true;},
    i=>changeProfile(i,p=>{p.limits.max_prs=11;}),
    i=>changeProfile(i,p=>{p.checks[0].argv=Array(257).fill('x');}),
    i=>{i.request.profile_digest='f'.repeat(64);},
  ]) { const i=input();mutate(i); assert.equal(planIntegration(i).status,'blocked'); }
  let called=false; const evil={get profile(){called=true;throw Error('getter');}};
  assert.equal(planIntegration(evil).status,'blocked');assert.equal(called,false);
  assert.equal(planIntegration(new Proxy({},{})).status,'blocked');
});
test('AC4: every pinned input changes freshness, including expected predecessor merge', () => {
  const i=input(), p=plan(i);
  assert.equal(freshIntegration(p,plan(i)),true);
  for (const mutate of [i=>{i.request.main_sha='a'.repeat(40);},i=>{i.request.targets[0].head_sha='b'.repeat(40);},i=>{i.request.targets[0].plan_digest='a'.repeat(64);},i=>{i.request.targets[1].depends_on=[1];},i=>{i.request.order=[2,1];},i=>changeProfile(i,p=>{p.image='sha256:'+'a'.repeat(64);})]) {
    const j=structuredClone(i);mutate(j);assert.equal(freshIntegration(p,plan(j)),false);
  }
});

async function rig(t, options={}) {
  const i=options.input??input(1), p=plan(i), g=github();
  // Re-sign synthetic P3 design proof for the test's pinned head/plan only.
  const target=g.grant.selected[0];target.head_sha=i.request.targets[0].head_sha;
  g.state.execution.expected_head=target.head_sha;
  g.snapshot.branches[0].sha=i.request.main_sha;
  g.snapshot.prs=i.request.targets.map(v=>({id:100+v.pr_number,number:v.pr_number,state:'open',draft:true,head_branch:g.state.execution.branch,head_sha:v.head_sha,base_branch:'main',base_sha:i.request.main_sha,head_repository_id:1,merged:false,updated_at:time,body_digest:hash(''),actor_id:99}));
  g.state.snapshot=structuredClone(g.snapshot);
  const authorized=await verifyRunAuthorization(g.input,g.provider);
  assert.equal(authorized.artifact.status,'allowed');
  const directory=mkdtempSync(join(tmpdir(),'integration-controller-'));
  chmodSync(directory,0o700);
  const task=Object.freeze({});
  let revoked=false;
  const authority=createIntegrationAuthority({mode:'synthetic',
    approveProfile:async q=>({binding_digest:q.binding_digest,approved:true,owner_id:7,observed_at:time,expires_at:'2026-11-04T06:00:00Z'}),
    authorize:async()=>({capability:authorized.capability,provider:g.provider,journal:g.journal}),
    dispatcher:{mode:'synthetic',async revalidate(h){return {status:h===task&&!revoked?'passed':'blocked'};}},
    tasks:[{issue_number:1,handle:task}],
  });
  const executor=createSyntheticIntegrationExecutor({async prepare(q){return {status:'passed',tree_sha:'a'.repeat(40),commit_sha:'b'.repeat(40),source_digest:hash(q.case),source:{},...options.prepare};},
    async verify(q){await options.during?.(q,g);return {status:'passed',exit_code:0,test_count:1,stdout_base64:'',stderr_base64:'',...options.verify};},async stop(){return {stopped:true};}});
  const c=await openIntegrationController({directory,...i,authority,executor:options.executor??executor,clock:now,bundle:options.bundle});
  t.after(()=>{c.close();g.close();rmSync(directory,{recursive:true,force:true});});
  return {c,i,g,authority,executor,revoke:()=>{revoked=true;}};
}
test('AC1/2/5: host result projects to execution/v1; failure returns original Issue/AC', async t=>{
  const {c}=await rig(t,{verify:{status:'failed',exit_code:1,test_count:1}});
  const r=await c.run();assert.equal(r.status,'failed');assert.equal(check('result',r),true);
  assert.deepEqual(r.repairs[0].issue_numbers,[1]);assert.deepEqual(r.repairs[0].ac_refs,['AC2']);
  assert.equal(r.repairs[0].destination,'original_issue_branch');
  const projected=projectIntegrationResult(r);
  assert.equal(projected.status,'failed');assert.equal(projected.targets[0].issue_number,1);
  const body=summarizeIntegration(r);assert(body.includes('#11'));assert(body.includes('not_evaluated'));
  assert(!body.includes('stdout_base64'));assert.equal(r.authority,false);
});
test('AC2/3: Git conflict differs from semantic fail; missing category and zero tests never pass', async t=>{
  const a=await rig(t,{prepare:{status:'conflict'}});const conflict=await a.c.run();
  assert.equal(conflict.cases[0].git_status,'conflict');assert.equal(conflict.status,'failed');
  const b=await rig(t,{verify:{test_count:0}});assert.notEqual((await b.c.run()).status,'passed');
  const i=input(1);changeProfile(i,p=>{p.required_categories.push('authorization');});
  const d=await rig(t,{input:i});assert.equal((await d.c.run()).status,'not_evaluated');
});
test('AC4: update during a command invalidates success; a stopped/revoked task cannot publish',async t=>{
  const r=await rig(t,{during:async(q,g)=>{g.state.snapshot.prs[0].head_sha='c'.repeat(40);}});
  assert.equal((await r.c.run()).status,'stale');
  assert.equal((await r.c.report()).status,'blocked');
  const s=await rig(t);await s.c.run();s.revoke();assert.equal((await s.c.recheck()).status,'blocked');
});
test('no worker JSON authority/executor or spoofed permit; stop and schema boundaries fail closed',async t=>{
  const i=input(1),directory=mkdtempSync(join(tmpdir(),'integration-denied-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  await assert.rejects(openIntegrationController({directory,...i,authority:{approved:true},executor:{},clock:now}));
  const {c}=await rig(t);await c.stop();assert.equal((await c.run()).status,'stopped');
  const r=await executeIntegrationSummaryOperation({}, {}, {});assert.equal(r.status,'failed');
});

function gitFixture(t) {
  const root=mkdtempSync(join(tmpdir(),'integration-git-')), repo=join(root,'original');mkdirSync(repo);
  const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-C',repo,...args],{encoding:'utf8',env:{PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.invalid',GIT_AUTHOR_DATE:'2026-11-04T00:00:00Z',GIT_COMMITTER_DATE:'2026-11-04T00:00:00Z'}}).trim();
  git('init','--initial-branch=main');mkdirSync(join(repo,'src'));
  writeFileSync(join(repo,'src/a.cjs'),'module.exports = 1;\n');writeFileSync(join(repo,'src/b.cjs'),'module.exports = 1;\n');
  writeFileSync(join(repo,'src/app.test.cjs'),"const test=require('node:test');const assert=require('node:assert/strict');test('compatible',()=>assert.ok(require('./a.cjs')*require('./b.cjs')<=2));\n");
  git('add','.');git('commit','-m','base');const main=git('rev-parse','HEAD');
  git('switch','-c','issue-a');writeFileSync(join(repo,'src/a.cjs'),'module.exports = 2;\n');git('add','.');git('commit','-m','a');const a=git('rev-parse','HEAD');
  git('switch','main');git('switch','-c','issue-b');writeFileSync(join(repo,'src/b.cjs'),'module.exports = 2;\n');git('add','.');git('commit','-m','b');const b=git('rev-parse','HEAD');
  git('switch','main');const bundle=join(root,'source.bundle');git('bundle','create',bundle,'--all');
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return {root,repo,git,main,a,b,bundle:{path:bundle,digest:digest(readFileSync(bundle))}};
}
test('AC1/2/6: real isolated Git and app; individual pass, combined fail, originals unchanged', {skip:!process.env.WORKFLOW_INTEGRATION_TEST_IMAGE}, async t=>{
  const f=gitFixture(t),i=input(),before=f.git('show-ref');i.request.main_sha=f.main;i.request.targets[0].head_sha=f.a;i.request.targets[1].head_sha=f.b;i.request.bundle_digest=f.bundle.digest;
  const p=plan(i),executor=createDockerIntegrationExecutor({image,clock:now});
  const outcomes=[];
  for(const c of p.cases){const q=await executor.prepare({plan:p,profile:i.profile,case:c,bundle:f.bundle,signal:new AbortController().signal});
    assert.equal(q.status,'passed');const result=await executor.verify({plan:p,profile:i.profile,case:c,prepared:q,check:i.profile.checks[0],signal:new AbortController().signal});
    outcomes.push(result.status);await executor.cleanup(q);
  }
  assert.deepEqual(outcomes,['passed','passed','failed']);assert.equal(f.git('show-ref'),before);assert.equal(f.git('status','--porcelain'),'');
});
