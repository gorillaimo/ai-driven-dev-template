import { readFileSync } from "node:fs";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
const ajv = new Ajv({ strict: true, allErrors: false });
addFormats(ajv);
const root = new URL("../../", import.meta.url);
for (const [dir, names] of [
  ["issue", ["common"]],
  ["project", ["common", "project", "delivery-plan"]],
  ["project-plan-checks", ["context"]],
  ["project-aggregate", ["context", "checkpoint", "result"]],
])
  for (const name of names)
    ajv.addSchema(
      JSON.parse(
        readFileSync(
          new URL(
            ".ai-workflow/schemas/" + dir + "/v1/" + name + ".schema.json",
            root,
          ),
          "utf8",
        ),
      ),
    );
export function validateAggregateArtifact(kind, value) {
  const id =
    kind === "project"
      ? "urn:ai-workflow:project:v1:project"
      : kind === "deliveryPlan"
        ? "urn:ai-workflow:project:v1:delivery-plan"
        : "urn:ai-workflow:project-aggregate:v1:" + kind;
  return { valid: !!ajv.getSchema(id)?.(value) };
}
