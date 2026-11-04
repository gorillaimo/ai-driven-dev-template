import { readFileSync } from "node:fs";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { badJson, finiteTimes } from "./core.mjs";
const ajv = new Ajv({ strict: true, allErrors: false });
addFormats(ajv);
const root = new URL("../../.ai-workflow/schemas/", import.meta.url);
for (const [namespace, kinds] of [
  ["issue", ["common"]],
  ["execution", ["common"]],
  [
    "github",
    [
      "common",
      "policy",
      "snapshot",
      "session-request",
      "authorization",
      "operation",
      "receipt",
    ],
  ],
])
  for (const kind of kinds)
    ajv.addSchema(
      JSON.parse(
        readFileSync(
          new URL(namespace + "/v1/" + kind + ".schema.json", root),
          "utf8",
        ),
      ),
    );
export function validateGitHubArtifact(kind, value) {
  if (
    ![
      "policy",
      "snapshot",
      "session-request",
      "authorization",
      "operation",
      "receipt",
      "proof",
      "machine",
    ].includes(kind) ||
    badJson(value) ||
    !finiteTimes(value)
  )
    return { valid: false };
  const validator = ajv.getSchema(
    ["proof", "machine"].includes(kind)
      ? "urn:ai-workflow:github:v1:common#/$defs/" + kind
      : "urn:ai-workflow:github:v1:" + kind,
  );
  return { valid: !!validator(value) };
}
