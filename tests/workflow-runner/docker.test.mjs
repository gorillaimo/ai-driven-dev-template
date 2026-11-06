import test from "node:test";
import assert from "node:assert/strict";
import { profile } from "./fixture.mjs";
import { dockerArgs } from "../../tools/workflow-runner/docker.mjs";
test("worker container is bounded, networkless, nonroot and has only approved mounts", () => {
  const p = profile(),
    q = {
      attempt_id: "attempt-1",
      role: "implementation",
      profile: p,
      workspace: {
        source: "/tmp/source",
        mounts: [{ source: "/tmp/write", target: "/work/src", path: "src" }],
      },
      socket_directory: "/tmp/gate",
    };
  const a = dockerArgs(q);
  for (const v of [
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--memory=512m",
    "--pids-limit=64",
    "--cpus=1",
    "--init",
  ])
    assert.ok(a.includes(v), v);
  assert.ok(
    !a.some((x) => /docker.sock|--privileged|network=host|pid=host/.test(x)),
  );
  assert.ok(a.includes("type=bind,src=/tmp/source,dst=/work,readonly"));
  assert.ok(a.includes("type=bind,src=/tmp/write,dst=/work/src"));
  q.role = "review";
  const r = dockerArgs(q);
  assert.ok(r.includes("type=bind,src=/tmp/write,dst=/work/src,readonly"));
});
test("Docker args reject a scope escape or unpinned image", () => {
  const p = profile(),
    q = {
      attempt_id: "attempt-1",
      role: "implementation",
      profile: p,
      workspace: {
        source: "/tmp/source",
        mounts: [{ source: "/tmp/write", target: "/etc", path: "src" }],
      },
      socket_directory: "/tmp/gate",
    };
  assert.throws(() => dockerArgs(q));
  q.workspace.mounts = [];
  p.image = "node:latest";
  assert.throws(() => dockerArgs(q));
});
