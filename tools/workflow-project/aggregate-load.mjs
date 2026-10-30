import { readLocal, parseYaml } from "workflow-rules/load";
import { inspectJson, MAX_BYTES, aggregateLimit } from "./aggregate-limits.mjs";
export function loadProjectAggregate(root, paths) {
  if (inspectJson(paths)) throw Error("load_paths");
  let bytes = 0;
  const read = (p) => {
    let raw;
    try {
      raw = readLocal(root, p);
    } catch {
      throw Error("load_invalid");
    }
    bytes += Buffer.byteLength(raw);
    if (bytes > MAX_BYTES) throw Error("load_size");
    try {
      return parseYaml(raw);
    } catch {
      throw Error("load_invalid");
    }
  };
  const exact = (x, required, optional = []) => {
    if (
      !x ||
      typeof x !== "object" ||
      Array.isArray(x) ||
      Object.keys(x).some((k) => ![...required, ...optional].includes(k)) ||
      required.some((k) => !(k in x))
    )
      throw Error("load_paths");
  };
  exact(
    paths,
    ["project", "deliveryPlan", "context", "workflows"],
    ["checkpoint"],
  );
  if (!Array.isArray(paths.workflows) || paths.workflows.length > 100)
    throw Error("load_paths");
  const result = {};
  for (const k of ["project", "deliveryPlan", "context"])
    result[k] = read(paths[k]);
  result.workflows = paths.workflows.map((b) => {
    exact(
      b,
      ["issue_ref", "plan", "state", "context", "ruleInput"],
      ["previous", "revisionPlans"],
    );
    const input = {};
    for (const k of ["plan", "state", "context", "ruleInput"])
      input[k] = read(b[k]);
    if (b.previous) {
      exact(b.previous, ["plan", "state"]);
      input.previous = {
        plan: read(b.previous.plan),
        state: read(b.previous.state),
      };
    }
    if (b.revisionPlans) {
      if (!Array.isArray(b.revisionPlans) || b.revisionPlans.length > 100)
        throw Error("load_paths");
      input.revisionPlans = b.revisionPlans.map(read);
    }
    return { issue_ref: b.issue_ref, input };
  });
  if (paths.checkpoint !== undefined)
    result.checkpoint = read(paths.checkpoint);
  if (inspectJson(result) || aggregateLimit(result)) throw Error("load_size");
  return result;
}
