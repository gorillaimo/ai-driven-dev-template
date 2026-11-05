import { readFileSync } from "node:fs";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { safe } from "./core.mjs";
const ajv = new Ajv({ strict: true, allErrors: false });
addFormats(ajv);
const root = new URL("../../.ai-workflow/schemas/", import.meta.url);
for (const [ns, version, kinds] of [
  ["issue", "v1", ["common"]],
  ["execution", "v1", ["common", "profile", "grant"]],
  ["github", "v1", ["common", "snapshot"]],
  ["project", "v2", ["common", "project", "team", "delivery-plan"]],
  [
    "dispatch",
    "v1",
    [
      "common",
      "request",
      "migration",
      "batch-plan",
      "ledger-view",
      "transition",
    ],
  ],
])
  for (const k of kinds)
    ajv.addSchema(
      JSON.parse(
        readFileSync(
          new URL(ns + "/" + version + "/" + k + ".schema.json", root),
          "utf8",
        ),
      ),
    );
export function valid(kind, v) {
  try {
    return safe(v) && !!ajv.getSchema(kind)(v);
  } catch {
    return false;
  }
}
export const validateDispatchArtifact = (kind, v) => ({
  valid: valid("urn:ai-workflow:dispatch:v1:" + kind, v),
});
