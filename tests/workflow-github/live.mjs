import { runLimitedTrial } from "../../tools/workflow-github/trial.mjs";
// Deliberately no key/URL/environment loader. A separately reviewed controller
// invokes this API with an explicitly approved sandbox and protected callbacks.
const result = await runLimitedTrial();
process.stdout.write(JSON.stringify(result) + "\n");
process.exitCode = 2;
