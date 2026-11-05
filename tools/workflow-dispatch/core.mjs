import { createHash } from "node:crypto";
import { canonical } from "workflow-rules/resolve";
import { inspectJson } from "../workflow-project/limits.mjs";
export const hash = (v) =>
  createHash("sha256").update(canonical(v)).digest("hex");
export const same = (a, b) => canonical(a) === canonical(b);
export function safe(v) {
  try {
    return !inspectJson(v);
  } catch {
    return false;
  }
}
const errors = new WeakMap();
export function makeError(code) {
  const e = new Error("dispatch_failed");
  errors.set(e, code);
  return e;
}
export function fail(code) {
  throw makeError(code);
}
export const code = (e, fallback = "dispatch_failed") =>
  errors.get(e) ?? fallback;
export const pathValid = (p) =>
  typeof p === "string" &&
  p.length <= 1024 &&
  /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(p) &&
  p
    .split("/")
    .every((s) => s !== "." && s !== ".." && s.toLowerCase() !== ".git");
export const within = (p, roots) =>
  roots.some((r) => p === r || p.startsWith(r + "/"));
export const overlap = (a, b) =>
  a.some((x) => within(x, b)) || b.some((x) => within(x, a));
export const fresh = (t, now) =>
  Number.isFinite(Date.parse(t)) &&
  Number.isFinite(Date.parse(now)) &&
  Date.parse(t) <= Date.parse(now) &&
  Date.parse(now) - Date.parse(t) <= 60000;
export const active = (c) => c.status !== "released";
export function conflicts(task, c, project) {
  return (
    overlap(task.allowed_paths, c.allowed_paths) ||
    task.areas.some(
      (id) =>
        c.areas.includes(id) &&
        project.areas.some(
          (a) =>
            a.area_id === id && (a.shared || a.conflict_policy === "serialize"),
        ),
    )
  );
}
export const configurationDigest = ({ project, team, deliveryPlan }) =>
  hash({ project, team, deliveryPlan });

export function snapshotConsistent(s) {
  if (Date.parse(s.started_at) > Date.parse(s.finished_at)) return false;
  for (const [rows, key] of [
    [s.issues, (v) => v.number],
    [s.issues, (v) => v.id],
    [s.prs, (v) => v.number],
    [s.prs, (v) => v.id],
    [s.branches, (v) => v.name],
    [s.sources, (v) => v.kind + "|" + v.id],
    [s.permissions, (v) => v.actor_id],
    [s.permissions, (v) => v.login],
    [s.protections, (v) => v.branch],
  ])
    if (new Set(rows.map(key)).size !== rows.length) return false;
  return true;
}
