import { readLocal, parseYaml, loadRules } from 'workflow-rules/load';

// No implicit Git/GitHub access. Snapshot collection belongs to the caller.
export function loadWorkflow(root, paths, ruleContext, optIns = []) {
  const read = path => parseYaml(readLocal(root,path));
  const result = { plan: read(paths.plan), state: read(paths.state), context: read(paths.context),
    ruleInput: { ...loadRules(root), context: ruleContext, optIns },
    revisionPlans: (paths.revisionPlans ?? []).map(read),
  };
  if (paths.previous) result.previous = { plan: read(paths.previous.plan), state: read(paths.previous.state) };
  return result;
}
