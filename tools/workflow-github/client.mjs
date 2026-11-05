import { performance } from "node:perf_hooks";
import { badJson, MAX, fail, nowValid, safeError } from "./core.mjs";
export const API_VERSION = "2026-03-10";
export async function boundedCall(callback, milliseconds, parent) {
  const controller = new AbortController();
  let timer;
  const stop = () => controller.abort();
  if (parent?.aborted) fail("operation_stopped");
  parent?.addEventListener("abort", stop, { once: true });
  try {
    return await Promise.race([
      Promise.resolve().then(() => callback(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => {
            reject(safeError("request_timeout"));
            controller.abort();
          },
          Math.max(1, milliseconds),
        );
        controller.signal.addEventListener(
          "abort",
          () => reject(safeError("operation_stopped")),
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", stop);
  }
}
export function createClient(
  transport,
  {
    repository,
    limits = MAX,
    clock = () => new Date().toISOString(),
    operation = false,
    signal,
  } = {},
) {
  if (
    badJson(limits) ||
    Object.keys(MAX).some(
      (k) =>
        !Number.isSafeInteger(limits[k]) || limits[k] < 1 || limits[k] > MAX[k],
    )
  )
    fail("limits_invalid");
  const started = performance.now(),
    duration =
      (operation ? limits.operation_seconds : limits.collector_seconds) * 1000,
    maximum = operation ? limits.operation_requests : limits.requests;
  const pages = [],
    cache = new Map();
  let count = 0,
    bytes = 0;
  async function request(method, path, body, allow304 = false) {
    const url = new URL(path, "https://api.github.com");
    if (
      url.origin !== "https://api.github.com" ||
      url.username ||
      url.password ||
      url.hash ||
      (!url.pathname.startsWith("/repos/" + repository + "/") &&
        url.pathname !== "/repos/" + repository) ||
      url.pathname.includes("%") ||
      url.pathname.includes("//") ||
      !["GET", "POST", "PATCH", "DELETE"].includes(method)
    )
      fail("endpoint_invalid");
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (
        ++count > maximum ||
        count > 400 ||
        performance.now() - started >= duration
      )
        fail("request_limit");
      const headers = {
        "X-GitHub-Api-Version": API_VERSION,
        Accept: "application/vnd.github+json",
      };
      if (allow304 && cache.has(path) && cache.get(path).etag)
        headers["If-None-Match"] = cache.get(path).etag;
      response = await boundedCall(
        (s) =>
          transport.request({
            method,
            path,
            headers,
            ...(body === undefined ? {} : { body }),
            signal: s,
          }),
        Math.min(10000, duration - (performance.now() - started)),
        signal,
      );
      if (
        badJson(response) ||
        !response ||
        !Number.isInteger(response.status) ||
        response.status < 100 ||
        response.status > 599 ||
        !response.headers ||
        typeof response.headers !== "object"
      )
        fail("response_invalid");
      const size = Buffer.byteLength(JSON.stringify(response));
      bytes += size;
      if (
        size > Math.min(limits.response_bytes, MAX.response_bytes) ||
        bytes > Math.min(limits.raw_bytes, MAX.raw_bytes)
      )
        fail("response_limit");
      response = {
        ...response,
        headers: Object.fromEntries(
          Object.entries(response.headers).map(([k, v]) => [
            k.toLowerCase(),
            v,
          ]),
        ),
      };
      const wait = Number(response.headers["retry-after"]);
      if (
        method === "GET" &&
        attempt === 0 &&
        ([429, 502, 503, 504].includes(response.status) ||
          (response.status === 403 && response.headers["retry-after"])) &&
        Number.isFinite(wait) &&
        wait >= 0 &&
        wait <= 5 &&
        performance.now() - started + wait * 1000 < duration
      ) {
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      break;
    }
    if (response.status === 304) {
      if (!allow304 || !cache.has(path)) fail("cache_missing");
      response = {
        ...response,
        status: 200,
        body: structuredClone(cache.get(path).body),
        revalidated: true,
      };
    }
    if (response.status >= 200 && response.status < 300 && method === "GET")
      cache.set(path, {
        body: structuredClone(response.body),
        etag: response.headers.etag ?? null,
      });
    return response;
  }
  async function list(
    path,
    max = limits.resource_items,
    identity = (row) => row?.id ?? row?.number ?? row?.name,
  ) {
    const first = new URL(path, "https://api.github.com");
    first.searchParams.set("per_page", String(limits.page_items));
    first.searchParams.set("page", "1");
    let url = first,
      page = 1;
    const rows = [],
      seen = new Set();
    while (url) {
      const address = url.pathname + url.search,
        r = await request("GET", address, undefined, true);
      if (r.status !== 200 || !Array.isArray(r.body))
        fail(
          r.status === 403 || r.status === 404
            ? "resource_unknown"
            : "pagination_failed",
        );
      const observed = clock();
      if (!nowValid(observed)) fail("time_invalid");
      pages.push({
        path: address,
        etag: r.headers.etag ?? null,
        observed_at: observed,
        row_count: r.body.length,
        revalidated: !!r.revalidated,
      });
      if (r.body.length > limits.page_items) fail("page_limit");
      for (const row of r.body) {
        const id = identity(row);
        if (id === undefined || seen.has(id)) fail("duplicate_resource");
        seen.add(id);
        rows.push(row);
        if (rows.length > max) fail("resource_limit");
      }
      let next = null;
      const link = r.headers.link;
      if (link !== undefined) {
        if (typeof link !== "string" || link.length > 8192)
          fail("link_invalid");
        const links = link.split(/,\s*(?=<)/);
        const relations = new Set();
        for (const part of links) {
          const match = /^<([^<>]+)>;\s*rel="(next|prev|first|last)"$/.exec(
            part.trim(),
          );
          if (!match || relations.has(match[2])) fail("link_invalid");
          relations.add(match[2]);
          const target = new URL(match[1]);
          if (
            target.origin !== first.origin ||
            target.pathname !== first.pathname ||
            target.username ||
            target.password ||
            target.hash ||
            [...target.searchParams.keys()].some(
              (k) => k !== "page" && !first.searchParams.has(k),
            ) ||
            [...first.searchParams].some(
              ([k, v]) => k !== "page" && target.searchParams.get(k) !== v,
            ) ||
            target.searchParams.getAll("page").length !== 1 ||
            !/^\d+$/.test(target.searchParams.get("page") ?? "")
          )
            fail("link_invalid");
          if (match[2] === "next") {
            if (Number(target.searchParams.get("page")) !== page + 1)
              fail("link_invalid");
            next = target;
          }
        }
      }
      if (!next && r.body.length === limits.page_items) {
        next = new URL(first);
        next.searchParams.set("page", String(page + 1));
      }
      if (next && page >= Math.ceil(max / limits.page_items) + 1)
        fail("page_limit");
      url = next;
      page++;
    }
    return rows;
  }
  function charge(amount) {
    if (!Number.isSafeInteger(amount) || amount < 0)
      fail("observation_usage_unknown");
    count += amount;
    if (count > maximum) fail("request_limit");
  }
  return {
    request,
    list,
    pages,
    charge,
    get requestCount() {
      return count;
    },
  };
}
