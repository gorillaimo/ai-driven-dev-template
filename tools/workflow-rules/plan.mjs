import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { resolveRules, canonical, validateArtifact } from './resolve.mjs';

const root = new URL('../../', import.meta.url);
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);
for (const kind of ['common', 'plan']) {
  ajv.addSchema(JSON.parse(readFileSync(
    new URL('.ai-workflow/schemas/issue/v1/' + kind + '.schema.json', root), 'utf8')));
}
const validatePlan = ajv.getSchema('urn:ai-workflow:issue:v1:plan');

export function projectPlan(plan, result, input) {
  if (!validatePlan(plan) || !validateArtifact('resolution', result).valid || result.status !== 'pass') {
    throw new Error('invalid_plan_resolution');
  }
  // Re-evaluate current inputs: extension values alone never authorize a plan.
  if (canonical(resolveRules(input)) !== canonical(result)) throw new Error('stale_or_modified_resolution');
  if (plan.risk !== input.context.risk) throw new Error('context_risk_mismatch');
  const output = structuredClone(plan), byId = new Map(result.rules.map(rule => [rule.rule_id, rule]));
  output.resolved_rules = result.order.map(id => {
    const { rule_id, version, reference } = byId.get(id);
    return { rule_id, version, reference };
  });
  output.extensions = { ...output.extensions, rule_resolution: structuredClone(result) };
  if (!validatePlan(output)) throw new Error('invalid_plan');
  return output;
}
