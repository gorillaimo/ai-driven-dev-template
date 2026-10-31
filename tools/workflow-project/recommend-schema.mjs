import { readFileSync } from "node:fs";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
const root = new URL("../../", import.meta.url),
  ajv = new Ajv({ strict: true, allErrors: false });
addFormats(ajv);
for (const [dir, names] of [
  ["issue", ["common"]],
  ["project", ["common", "project", "delivery-plan", "team"]],
  ["project-member-checks", ["context"]],
  ["project-recommend", ["context", "result"]],
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
export function validateRecommendationArtifact(kind, value) {
  const id =
    kind === "project" || kind === "team"
      ? "urn:ai-workflow:project:v1:" + kind
      : kind === "deliveryPlan"
        ? "urn:ai-workflow:project:v1:delivery-plan"
        : "urn:ai-workflow:project-recommend:v1:" + kind;
  return { valid: !!ajv.getSchema(id)?.(value) };
}
