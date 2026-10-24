import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { resolveRules, canonical, digest, compare } from 'workflow-rules/resolve';
import { inspectPlan, same, ext } from './plan.mjs';
import { inspectState } from './state.mjs';
import { inspectResume } from './resume.mjs';
import { messages } from './messages.mjs';
const root = new URL('../../', import.meta.url);
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);
for (const kind of ['common','plan','state']) {
  ajv.addSchema(JSON.parse(readFileSync(new URL('.ai-workflow/schemas/issue/v1/'+kind+'.schema.json',root),'utf8')));
}
for (const kind of ['context','result','state-extension']) {
  ajv.addSchema(JSON.parse(readFileSync(new URL('.ai-workflow/schemas/checks/v1/'+kind+'.schema.json',root),'utf8')));
}
export function validateArtifact(kind, value) {
  const urn = ['plan','state'].includes(kind) ? 'urn:ai-workflow:issue:v1:' : 'urn:ai-workflow:checks:v1:';
  const validate = ajv.getSchema(urn + kind);
  return !!validate?.(value);
}

export function checkWorkflow(input = {}) {
  input = input ?? {};
  const diagnostics = [], checks = [];
  const add = (code,path='',stage=null,event=null) => {
    if (!messages[code]) throw new Error('Unknown diagnostic');
    diagnostics.push({ code, path, stage, event });
  };
  const check = (id, action) => {
    const before = diagnostics.length; action();
    checks.push({ check_id: id, status: diagnostics.length === before ? 'pass' : 'block' });
  };
  let resume = { resume_decision: 'blocked', next_stage: null };
  check('schema', () => {
    if (input.revisionPlans !== undefined && !Array.isArray(input.revisionPlans)) add('schema_invalid','revisionPlans');
    for (const kind of ['plan','state','context']) if (!validateArtifact(kind,input[kind])) add('schema_invalid',kind);
    if (!validateArtifact('state-extension',ext(input.state ?? {}))) add('schema_invalid','state/extensions/workflow_check');
    if (input.previous && (!validateArtifact('plan',input.previous.plan) || !validateArtifact('state',input.previous.state) || !validateArtifact('state-extension',ext(input.previous.state ?? {})))) add('schema_invalid','previous');
  });
  if (!diagnostics.length) {
    const { plan, state, context, ruleInput } = input;
    check('identity', () => {
      for (const key of ['work_id','work_source','issue_ref','project_id','feature_id']) {
        if (plan[key] !== state[key] || plan[key] !== context[key]) add('identity_mismatch',key);
      }
      if (plan.risk !== context.risk || ruleInput?.context?.risk !== context.risk) add('identity_mismatch','risk');
      if (context.work_source === 'github_issue') {
        const number = context.issue_ref.split('/').at(-1);
        if (context.work_id !== 'issue-' + number) add('identity_mismatch','work_id');
      }
      if (input.previous && input.previous.state.plan_revision !== input.previous.plan.revision) add('revision_invalid','previous/state/plan_revision');
      if (input.previous) for (const key of ['work_id','work_source','issue_ref','project_id','feature_id']) {
        if (input.previous.plan[key] !== plan[key] || input.previous.state[key] !== state[key]) add('identity_mismatch','previous/'+key);
      }
    });
    check('rules', () => {
      try {
        const result = resolveRules(ruleInput);
        const byId = new Map(result.rules.map(r=>[r.rule_id,r]));
        const refs = result.order.map(id => {const {rule_id,version,reference}=byId.get(id);return {rule_id,version,reference};});
        if (result.status !== 'pass' || !same(result,plan.extensions?.rule_resolution) || !same(refs,plan.resolved_rules)) add('rule_mismatch','plan/resolved_rules');
      } catch { add('rule_mismatch','ruleInput'); }
    });
    let graph;
    check('plan', () => { graph = inspectPlan(plan,context,add).graph; });
    let snapshot;
    check('state', () => { snapshot = inspectState(input,graph,add,validateArtifact); });
    checks.push({ check_id: 'append_only', status: input.previous ?
      (diagnostics.some(d=>d.code==='history_rewritten') ? 'block' : 'pass') : 'not_evaluated' });
    const validSnapshot = !diagnostics.length;
    check('resume', () => { resume = inspectResume(input,snapshot,add); });
    if (!validSnapshot || checks.at(-1).status === 'block' || resume.next_stage === null) {
      resume = { resume_decision: snapshot.terminal && validSnapshot ? 'terminal' : 'blocked', next_stage: null };
    }
  }
  const result = {
    schema_version: 1, checker_version: '1.0.0', input_digest: digest(canonical(input)),
    status: diagnostics.length ? 'blocked' : 'pass', checks,
    diagnostics: [...new Map(diagnostics.map(d=>[canonical(d),d])).values()].sort((a,b)=>compare(canonical(a),canonical(b))),
    ...resume,
  };
  if (!validateArtifact('result',result)) throw new Error('Invalid checker result');
  return result;
}
