import { performance } from "node:perf_hooks";
import { fail } from "./core.mjs";
// Actual HTTP calls include App issuance/revocation. Reserve cleanup capacity.
export function createTrialBudget({ clock = () => performance.now() } = {}) {
  const start = clock(),
    controller = new AbortController();
  let count = 0,
    closed = false,
    revoked = false;
  if (!Number.isFinite(start)) fail("trial_clock_invalid");
  const timer = setTimeout(() => controller.abort(), 880000);
  timer.unref?.();
  return {
    get requestCount() {
      return count;
    },
    signal: controller.signal,
    charge(method, path) {
      const elapsed = clock() - start,
        cleanup = method === "DELETE" && path === "/installation/token";
      if (
        closed ||
        !Number.isFinite(elapsed) ||
        elapsed < 0 ||
        elapsed >= (cleanup ? 890000 : 880000) ||
        count >= (cleanup ? 100 : 99) ||
        (cleanup && revoked) ||
        (!cleanup && controller.signal.aborted)
      )
        fail("trial_budget_exhausted");
      if (cleanup) revoked = true;
      count++;
    },
    close() {
      closed = true;
      clearTimeout(timer);
      controller.abort();
    },
  };
}
