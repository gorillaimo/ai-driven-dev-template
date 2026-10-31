import { readLocal, parseYaml } from "workflow-rules/load";
import {
  inspectJson,
  MAX_BYTES,
  recommendationLimit,
} from "./recommend-limits.mjs";
export function loadProjectRecommendation(root, paths) {
  let invalid;
  try {
    invalid = inspectJson(paths);
  } catch {
    invalid = "input_invalid";
  }
  if (invalid) throw Error("load_paths");
  const exact = (v, required, optional = []) => {
    if (
      !v ||
      typeof v !== "object" ||
      Array.isArray(v) ||
      Object.keys(v).some((k) => ![...required, ...optional].includes(k)) ||
      required.some((k) => !Object.hasOwn(v, k))
    )
      throw Error("load_paths");
  };
  let bytes = 0,
    files = 0;
  const read = (path) => {
    let raw;
    try {
      raw = readLocal(root, path);
    } catch {
      throw Error("load_invalid");
    }
    bytes += Buffer.byteLength(raw);
    if (++files > 10620 || bytes > MAX_BYTES) throw Error("load_size");
    let v;
    try {
      v = parseYaml(raw);
    } catch {
      throw Error("load_invalid");
    }
    let bad;
    try {
      bad = inspectJson(v);
    } catch {
      bad = true;
    }
    if (bad) throw Error("load_size");
    return v;
  };
  exact(paths, [
    "project",
    "deliveryPlan",
    "team",
    "aggregate",
    "planning",
    "context",
  ]);
  exact(paths.aggregate, ["context", "workflows"], ["checkpoint"]);
  exact(paths.planning, ["replan_decisions"], ["previous"]);
  const a = paths.aggregate;
  if (!Array.isArray(a.workflows) || a.workflows.length > 100)
    throw Error("load_paths");
  const i = Object.fromEntries(
    ["project", "deliveryPlan", "team", "context"].map((k) => [
      k,
      read(paths[k]),
    ]),
  );
  i.aggregate = {
    context: read(a.context),
    workflows: a.workflows.map((b) => {
      exact(
        b,
        ["issue_ref", "plan", "state", "context", "ruleInput"],
        ["previous", "revisionPlans"],
      );
      const input = Object.fromEntries(
        ["plan", "state", "context", "ruleInput"].map((k) => [k, read(b[k])]),
      );
      if (b.previous !== undefined) {
        exact(b.previous, ["plan", "state"]);
        input.previous = {
          plan: read(b.previous.plan),
          state: read(b.previous.state),
        };
      }
      if (b.revisionPlans !== undefined) {
        if (!Array.isArray(b.revisionPlans) || b.revisionPlans.length > 100)
          throw Error("load_paths");
        input.revisionPlans = b.revisionPlans.map(read);
      }
      return { issue_ref: b.issue_ref, input };
    }),
  };
  if (a.checkpoint !== undefined) i.aggregate.checkpoint = read(a.checkpoint);
  i.planning = { replan_decisions: read(paths.planning.replan_decisions) };
  if (paths.planning.previous !== undefined) {
    exact(paths.planning.previous, ["project", "deliveryPlan", "context"]);
    i.planning.previous = Object.fromEntries(
      ["project", "deliveryPlan", "context"].map((k) => [
        k,
        read(paths.planning.previous[k]),
      ]),
    );
  }
  if (inspectJson(i) || recommendationLimit(i)) throw Error("load_size");
  return i;
}
