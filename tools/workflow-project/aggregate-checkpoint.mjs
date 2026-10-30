import { canonical, digest, compare } from "workflow-rules/resolve";
export const bindingKeys = [
  "project_id",
  "repository",
  "project_revision",
  "plan_revision",
  "project_digest",
  "plan_digest",
];
export function prepareCheckpoint(context, old, inputDigest, add) {
  let valid = true;
  if (
    old &&
    (bindingKeys.some((k) =>
      k === "repository"
        ? old[k].toLowerCase() !== context[k].toLowerCase()
        : old[k] !== context[k],
    ) ||
      Date.parse(old.observed_at) > Date.parse(context.observed_at))
  ) {
    add("checkpoint_mismatch", "checkpoint");
    valid = false;
  }
  const prior = new Map();
  for (const r of old?.issues ?? []) {
    if (prior.has(r.work_id)) {
      add("checkpoint_mismatch", "checkpoint");
      valid = false;
    }
    prior.set(r.work_id, r);
  }
  return {
    valid,
    prior,
    next: new Map(prior),
    finish() {
      if (!valid) return old ?? null;
      const binding = Object.fromEntries(
        bindingKeys.map((k) => [k, context[k]]),
      );
      return {
        schema_version: 1,
        ...binding,
        source_input_digest: inputDigest,
        observed_at: context.observed_at,
        issues: [...this.next.values()].sort((a, b) =>
          compare(a.work_id, b.work_id),
        ),
      };
    },
  };
}
export function inspectEvents(row, workflow, cp, add) {
  const events = workflow.state.history.map((e) => ({
      event_id: e.event_id,
      digest: digest(canonical(e)),
    })),
    old = cp.prior.get(row.work_id);
  const valid =
    !old ||
    (old.issue_ref.toLowerCase() === row.issue_ref.toLowerCase() &&
      old.events.length <= events.length &&
      old.events.every((e, n) => canonical(e) === canonical(events[n])));
  if (!valid) add("history_rewritten", "checkpoint");
  return {
    valid,
    events,
    newCount: valid ? events.length - (old?.events.length ?? 0) : 0,
  };
}
