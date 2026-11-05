import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
test("fixed Python helper refuses an API-version override before HTTP", () => {
  const script =
    "import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location('helper',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\ncalls=[]\ndef no_network(*a,**k):\n calls.append(True);raise ValueError()\nm.urllib.request.build_opener=no_network\ntry:m.request({'method':'GET','path':'/repos/example/synthetic','headers':{'X-GitHub-Api-Version':'1900-01-01'}})\nexcept Exception:pass\nprint(json.dumps({'calls':len(calls)}))";
  const r = spawnSync(
    "python3",
    [
      "-B",
      "-c",
      script,
      fileURLToPath(
        new URL("../../tools/workflow-github/http_transport.py", import.meta.url),
      ),
    ],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).calls, 0);
});
