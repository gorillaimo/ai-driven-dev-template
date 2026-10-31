import {
  checkProjectPlan,
  validateArtifact as validatePlan,
} from "../workflow-project/check.mjs";
import { checkProjectMembers } from "../workflow-project/members.mjs";
import { validateMemberArtifact } from "../workflow-project/member-schema.mjs";
import {
  aggregateProject,
  validateAggregateArtifact,
} from "../workflow-project/aggregate.mjs";
import {
  recommendNextWork,
  validateRecommendationArtifact,
} from "../workflow-project/recommend.mjs";

// Fixed dispatch: fixtures supply data only, never a module or executable hook.
const adapters = Object.freeze({
  project_plan: [checkProjectPlan, validatePlan],
  project_members: [checkProjectMembers, validateMemberArtifact],
  project_aggregate: [aggregateProject, validateAggregateArtifact],
  project_recommend: [recommendNextWork, validateRecommendationArtifact],
});
export function evaluateProject(adapter, input) {
  if (!Object.hasOwn(adapters, adapter)) throw Error("adapter_unknown");
  const [check, validate] = adapters[adapter];
  const result = check(input);
  if (!validate("result", result).valid) throw Error("result_invalid");
  return result;
}
