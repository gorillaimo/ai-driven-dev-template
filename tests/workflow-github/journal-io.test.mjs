import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("journal syncs new directory entries and refuses to continue after an I/O failure", () => {
  const script = `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {tmpdir} from 'node:os';import {join} from 'node:path';
 const actualSync=fs.fsyncSync;let directorySynced=false;fs.fsyncSync=fd=>{if(fs.fstatSync(fd).isDirectory())directorySynced=true;return actualSync(fd);};syncBuiltinESMExports();
 const {createFileJournal}=await import(${JSON.stringify(new URL("../../tools/workflow-github/journal.mjs", import.meta.url).href)});
 const directory=fs.mkdtempSync(join(tmpdir(),'journal-failure-'));const j=createFileJournal({directory,sourceRoot:${JSON.stringify(new URL("../../", import.meta.url).pathname)}});
 const data={event_id:'e',nonce:'n',run_id:'r',request_digest:'a'.repeat(64)},write=fs.writeSync;fs.writeSync=()=>{throw Error('PRIVATE_IO_ERROR');};syncBuiltinESMExports();try{j.admit(data);}catch{}fs.writeSync=write;syncBuiltinESMExports();let blocked=false;try{j.admit(data);}catch{blocked=true;}j.close();console.log(JSON.stringify({directorySynced,blocked}));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.equal(result.directorySynced, true);
  assert.equal(result.blocked, true);
});
