import { createHash } from "node:crypto";
import { canonical } from "workflow-rules/resolve";
import { types } from "node:util";
import { readFileSync } from "node:fs";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

// core
function inspectJson(input) {
  const pending = [{ v: input, depth: 0 }],
    active = new Set();
  let nodes = 0,
    bytes = 0;
  while (pending.length) {
    const { v, depth, leave } = pending.pop();
    if (leave) {
      active.delete(v);
      continue;
    }
    if (++nodes > 200000 || depth > 32) return true;
    if (v === null || typeof v === "boolean") continue;
    if (typeof v === "string") {
      bytes += Buffer.byteLength(v);
      if (bytes > 5 * 1024 * 1024) return true;
      continue;
    }
    if (typeof v === "number") {
      if (!Number.isFinite(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER)
        return true;
      continue;
    }
    if (typeof v !== "object" || types.isProxy(v)) return true;
    const array = Array.isArray(v),
      proto = Object.getPrototypeOf(v);
    if (
      array
        ? proto !== Array.prototype
        : proto !== Object.prototype && proto !== null
    )
      return true;
    if (active.has(v)) return true;
    active.add(v);
    pending.push({ v, leave: true });
    const descriptors = Object.getOwnPropertyDescriptors(v),
      keys = Reflect.ownKeys(descriptors);
    if (keys.length > 200000 - nodes) return true;
    if (
      array &&
      (keys.length !== v.length + 1 ||
        keys.some(
          (k) =>
            k !== "length" &&
            (typeof k !== "string" ||
              !/^(0|[1-9][0-9]*)$/.test(k) ||
              Number(k) >= v.length),
        ))
    )
      return true;
    for (const k of keys) {
      if (array && k === "length") continue;
      const d = descriptors[k];
      if (typeof k !== "string" || !d.enumerable || !("value" in d))
        return true;
      bytes += Buffer.byteLength(k);
      if (bytes > 5 * 1024 * 1024) return true;
      pending.push({ v: d.value, depth: depth + 1 });
    }
  }
  return Buffer.byteLength(canonical(input)) > 5 * 1024 * 1024;
}
export { canonical };
export const hash = (v) =>
  createHash("sha256").update(canonical(v)).digest("hex");
export const safe = (v) => {
  try {
    return !inspectJson(v);
  } catch {
    return false;
  }
};
const errors = new WeakMap();
export function error(code) {
  const e = new Error("runner_failed");
  errors.set(e, code);
  return e;
}
export function fail(code) {
  throw error(code);
}
export const code = (e) => errors.get(e) ?? "runner_failed";
export const pathValid = (p) =>
  typeof p === "string" &&
  p.length <= 1024 &&
  /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(p) &&
  p.split("/").every((x) => ![".", "..", ".git"].includes(x.toLowerCase()));
export const within = (p, roots) =>
  roots.some((r) => p === r || p.startsWith(r + "/"));
export const overlap = (a, b) =>
  a.some((x) => within(x, b)) || b.some((x) => within(x, a));
export const fresh = (t, now) =>
  Number.isFinite(Date.parse(t)) &&
  Number.isFinite(Date.parse(now)) &&
  Date.parse(t) <= Date.parse(now) &&
  Date.parse(now) - Date.parse(t) <= 60000;
export async function bounded(fn, ms = 10000) {
  let timer;
  const signal = AbortSignal.timeout(ms);
  try {
    return await Promise.race([
      Promise.resolve().then(() => fn(signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(error("port_timeout")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export const ADAPTER_DIGEST =
  "a0bf572d2f93f056c6712a6da348e96078dc84f3885fd7be67807ef389cb3978";

// schema
const ajv = new Ajv({ strict: true });
addFormats(ajv);
for (const [ns, names] of [
  ["issue", ["common"]],
  ["execution", ["common"]],
  [
    "runner",
    ["profile", "request", "capability", "attempt", "usage", "result"],
  ],
])
  for (const name of names)
    ajv.addSchema(
      JSON.parse(
        readFileSync(
          new URL(
            "../../.ai-workflow/schemas/" + ns + "/v1/" + name + ".schema.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
export function valid(kind, value) {
  try {
    return (
      safe(value) && !!ajv.getSchema("urn:ai-workflow:runner:v1:" + kind)(value)
    );
  } catch {
    return false;
  }
}

// profile
export function checkProfile(p, now) {
  const r = {
    status: "blocked",
    authority: false,
    digest: null,
    diagnostics: [],
  };
  if (!safe(p) || !valid("profile", p)) {
    r.diagnostics = ["profile_invalid"];
    return r;
  }
  const paths = [
    ...p.read_paths,
    ...p.write_paths,
    ...p.send_paths,
    ...p.forbidden_paths,
  ];
  if (
    paths.some((x) => !pathValid(x)) ||
    !p.read_paths.length ||
    !p.write_paths.length ||
    !p.send_paths.length ||
    p.write_paths.some(
      (x) =>
        !within(x, p.read_paths) ||
        /(^|\/)\.(codex|agents|ssh|aws)(\/|$)/i.test(x),
    ) ||
    p.send_paths.some((x) => !within(x, p.read_paths)) ||
    overlap(p.write_paths, p.forbidden_paths) ||
    overlap(p.send_paths, p.forbidden_paths) ||
    p.write_paths.some((x, i) =>
      p.write_paths.some((y, j) => i !== j && overlap([x], [y])),
    )
  ) {
    r.diagnostics = ["profile_scope_invalid"];
    return r;
  }
  if (
    p.adapter_digest !== ADAPTER_DIGEST ||
    !Number.isFinite(Date.parse(now)) ||
    Date.parse(p.model.pricing_expires_at) <= Date.parse(now) ||
    p.limits.call_seconds > p.limits.run_seconds ||
    p.limits.max_input_tokens > p.model.context_tokens
  ) {
    r.diagnostics = ["profile_binding_invalid"];
    return r;
  }
  return { ...r, status: "passed", digest: hash(p) };
}
