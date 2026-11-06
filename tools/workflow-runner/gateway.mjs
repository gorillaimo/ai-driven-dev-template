import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { chmodSync, lstatSync, unlinkSync } from "node:fs";
import { bounded, code, error, fail, hash, safe } from "./core.mjs";
import { checkProfile } from "./core.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// gateway
const gateways = new WeakMap();
export const gatewayInfo = (value) => gateways.get(value);
function permitted(v) {
  if (v === null || typeof v !== "object") return true;
  if (Array.isArray(v)) return v.every(permitted);
  if (
    [
      "input_file",
      "input_image",
      "computer",
      "web_search",
      "web_search_preview",
      "file_search",
      "code_interpreter",
      "mcp",
    ].includes(v.type) ||
    Object.keys(v).some((k) =>
      ["file_url", "image_url", "server_url", "vector_store_ids"].includes(k),
    )
  )
    return false;
  return Object.values(v).every(permitted);
}
function terminal(r) {
  if (r.content_type.startsWith("application/json")) return JSON.parse(r.body);
  if (!r.content_type.startsWith("text/event-stream"))
    fail("provider_protocol_invalid");
  const events = r.body
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => l.slice(6))
    .filter((l) => l !== "[DONE]")
    .map((l) => JSON.parse(l));
  const completed = events.filter((e) => e.type === "response.completed");
  if (
    completed.length !== 1 ||
    events.some((e) =>
      ["error", "response.failed", "response.incomplete"].includes(e.type),
    )
  )
    fail("provider_response_unknown");
  return completed[0].response;
}
export function createGateway({
  mode,
  profile: p,
  ledger,
  observeAttempt,
  upstream,
  clock = () => new Date().toISOString(),
}) {
  if (
    !["synthetic", "production"].includes(mode) ||
    typeof upstream !== "function" ||
    (mode === "production" && !isProviderTransport(upstream)) ||
    (mode === "synthetic" && isProviderTransport(upstream)) ||
    typeof observeAttempt !== "function" ||
    typeof ledger?.reserveUsage !== "function" ||
    typeof ledger?.settleUsage !== "function"
  )
    fail("gateway_invalid");
  if (checkProfile(p, clock()).status !== "passed")
    fail("gateway_profile_invalid");
  p = structuredClone(p);
  const receipts = new Map();
  let unknown = false,
    tail = Promise.resolve(),
    waiting = 0;
  async function perform(q, attempt_id) {
    if (
      unknown ||
      !safe(q) ||
      checkProfile(p, clock()).status !== "passed" ||
      q.method !== "POST" ||
      q.path !== "/v1/responses" ||
      !safe(q.body) ||
      !q.body ||
      typeof q.body !== "object" ||
      Array.isArray(q.body)
    )
      fail("gateway_request_invalid");
    const b = structuredClone(q.body);
    const keys = [
      "model",
      "input",
      "instructions",
      "tools",
      "tool_choice",
      "parallel_tool_calls",
      "stream",
      "max_output_tokens",
      "reasoning",
      "store",
      "include",
      "previous_response_id",
      "text",
      "metadata",
      "prompt_cache_key",
      "truncation",
      "context_management",
      "service_tier",
      "stream_options",
      "client_metadata",
    ];
    if (
      Object.keys(b).some((k) => !keys.includes(k)) ||
      b.model !== p.model.id ||
      !permitted(b) ||
      b.tools?.some((t) => t.type !== "function") ||
      (b.max_output_tokens !== undefined &&
        (!Number.isInteger(b.max_output_tokens) ||
          b.max_output_tokens < 1 ||
          b.max_output_tokens > p.limits.max_output_tokens)) ||
      Buffer.byteLength(JSON.stringify(b)) >
        Math.min(5 * 1024 * 1024, p.limits.max_input_tokens)
    )
      fail("gateway_scope_invalid");
    b.max_output_tokens ??= p.limits.max_output_tokens;
    b.store = false;
    b.service_tier = "default";
    const a = await bounded(() => observeAttempt(attempt_id));
    if (!safe(a) || a.attempt_id !== attempt_id || !a.active || a.stopped)
      fail("attempt_stopped");
    const request_id = "req-" + randomUUID(),
      input_digest = hash(b);
    await ledger.reserveUsage({
      request_id,
      attempt_id,
      epoch: a.epoch,
      input_digest,
      now: clock(),
    });
    try {
      const response = await bounded(
        () => upstream(b),
        p.limits.call_seconds * 1000,
      );
      if (
        !safe(response) ||
        response.status !== 200 ||
        typeof response.body !== "string" ||
        Buffer.byteLength(response.body) > 16 * 1024 * 1024
      )
        fail("provider_response_unknown");
      const value = terminal(response),
        u = value?.usage;
      if (
        !u ||
        !Number.isSafeInteger(u.input_tokens) ||
        !Number.isSafeInteger(u.output_tokens) ||
        u.input_tokens < 0 ||
        u.input_tokens > p.limits.max_input_tokens ||
        u.output_tokens < 0 ||
        u.output_tokens > b.max_output_tokens
      )
        fail("usage_unknown");
      await ledger.settleUsage({
        request_id,
        attempt_id,
        epoch: a.epoch,
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        response_digest: hash(value),
        now: clock(),
      });
      const message = (value.output ?? [])
        .filter((x) => x.type === "message" && x.role === "assistant")
        .flatMap((x) => x.content ?? [])
        .filter((x) => x.type === "output_text" && typeof x.text === "string")
        .map((x) => x.text)
        .join("");
      receipts.set(
        attempt_id,
        Object.freeze({
          request_id,
          response_digest: hash(value),
          message_digest: hash(message),
          usage: { ...u },
        }),
      );
      return {
        status: response.status,
        body: response.body,
        content_type: response.content_type,
      };
    } catch {
      unknown = true;
      fail("provider_response_unknown");
    }
  }
  const value = Object.freeze({
    receipt: (attempt_id) => receipts.get(attempt_id) ?? null,
    request(q, attempt_id) {
      if (waiting >= 64) return Promise.reject(new Error("gateway_busy"));
      waiting++;
      const r = tail.then(() => perform(q, attempt_id));
      tail = r.catch(() => {}).finally(() => waiting--);
      return r;
    },
    get unknown() {
      return unknown;
    },
  });
  gateways.set(value, { mode, profile_digest: hash(p) });
  return value;
}
export async function serveGateway({ socket, attempt_id, gateway }) {
  let closed = false;
  const server = createServer((req, res) => {
    let bytes = 0,
      parts = [];
    req.on("data", (part) => {
      bytes += part.length;
      if (bytes > 5 * 1024 * 1024) {
        parts = [];
        req.destroy();
      } else parts.push(part);
    });
    req.on("error", () => {});
    req.on("end", async () => {
      try {
        const q = {
          method: req.method,
          path: req.url,
          body: JSON.parse(Buffer.concat(parts).toString("utf8")),
        };
        const r = await gateway.request(q, attempt_id);
        if (!res.destroyed) {
          res.writeHead(r.status, {
            "content-type": r.content_type,
            "cache-control": "no-store",
          });
          res.end(r.body);
        }
      } catch {
        if (!res.destroyed) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end('{"error":"model_request_blocked"}');
        }
      }
    });
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 1800000;
  server.maxHeadersCount = 20;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  chmodSync(socket, 0o600);
  return {
    async close() {
      if (closed) return;
      closed = true;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      if (lstatSync(socket, { throwIfNoEntry: false })?.isSocket())
        unlinkSync(socket);
    },
  };
}

// provider
const providers = new WeakSet();
// Host-only key injection. No key discovery or inherited CLI login, and no
// caller-selected URL/proxy/headers. The helper follows the managed proxy/CA.
export function createProviderTransport({
  credential,
  timeout_seconds = 1800,
}) {
  if (
    typeof credential !== "string" ||
    credential.length < 10 ||
    credential.length > 1024 ||
    !/^[A-Za-z0-9_-]+$/.test(credential) ||
    !Number.isInteger(timeout_seconds) ||
    timeout_seconds < 1 ||
    timeout_seconds > 1800
  )
    fail("provider_invalid");
  const send = async (body) =>
    new Promise((resolve, reject) => {
      const env = {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        LANG: "C.UTF-8",
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONNOUSERSITE: "1",
      };
      for (const k of [
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "NO_PROXY",
        "SSL_CERT_FILE",
        "REQUESTS_CA_BUNDLE",
      ])
        if (process.env[k]) env[k] = process.env[k];
      const child = spawn(
        "python3",
        [fileURLToPath(new URL("./provider_http.py", import.meta.url))],
        { env, shell: false, stdio: ["pipe", "pipe", "pipe"] },
      );
      let raw = "",
        size = 0,
        done = false;
      const stop = () => {
        child.kill("SIGKILL");
        if (!done) {
          done = true;
          reject(error("provider_response_unknown"));
        }
      };
      const timer = setTimeout(stop, (timeout_seconds + 5) * 1000);
      child.on("error", stop);
      child.stdin.on("error", stop);
      child.stderr.on("data", stop);
      child.stdout.on("data", (b) => {
        size += b.length;
        if (size > 20 * 1024 * 1024) stop();
        else raw += b.toString("utf8");
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (done) return;
        done = true;
        try {
          if (code !== 0) throw Error();
          const r = JSON.parse(raw);
          if (
            !Number.isInteger(r.status) ||
            typeof r.body !== "string" ||
            typeof r.content_type !== "string"
          )
            throw Error();
          resolve(r);
        } catch {
          reject(error("provider_response_unknown"));
        }
      });
      child.stdin.end(JSON.stringify({ credential, body, timeout_seconds }));
    });
  providers.add(send);
  return send;
}
export const isProviderTransport = (p) => providers.has(p);
