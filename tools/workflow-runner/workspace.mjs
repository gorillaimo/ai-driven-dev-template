import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  lstatSync,
  readdirSync,
  opendirSync,
  chmodSync,
  realpathSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { pathValid, within, overlap, hash, safe, fail } from "./core.mjs";
const workspaces = new WeakMap();
function directories(directory, p) {
  const source = join(directory, "source"),
    writes = join(directory, "writes");
  return {
    source,
    session: join(directory, "session"),
    mounts: p.write_paths.map((path, i) => ({
      path,
      source: join(writes, String(i)),
      target: "/work/" + path,
    })),
  };
}
export function prepareWorkspace({ directory, profile: p, files }) {
  if (
    !safe(files) ||
    !Array.isArray(files) ||
    files.length > 10000 ||
    directory !== resolve(directory) ||
    realpathSync(directory) !== directory ||
    !lstatSync(directory).isDirectory() ||
    readdirSync(directory).length
  )
    fail("workspace_invalid");
  if (
    !Array.isArray(p?.write_paths) ||
    p.write_paths.some(
      (x, i) =>
        !pathValid(x) ||
        p.write_paths.some((y, j) => i !== j && overlap([x], [y])),
    )
  )
    fail("workspace_scope_invalid");
  const seen = new Set();
  let bytes = 0;
  const source = join(directory, "source"),
    writes = join(directory, "writes");
  mkdirSync(source, { mode: 0o700 });
  mkdirSync(writes, { mode: 0o700 });
  mkdirSync(join(directory, "session"), { mode: 0o700 });
  for (const row of files) {
    if (
      !safe(row) ||
      Object.keys(row).sort().join() !== "content,path" ||
      !pathValid(row.path) ||
      /(^|\/)\.(codex|agents|ssh|aws)(\/|$)/i.test(row.path) ||
      seen.has(row.path) ||
      !within(row.path, p.read_paths) ||
      !within(row.path, p.send_paths) ||
      within(row.path, p.forbidden_paths) ||
      typeof row.content !== "string"
    )
      fail("workspace_file_invalid");
    seen.add(row.path);
    bytes += Buffer.byteLength(row.content);
    if (bytes > 100 * 1024 * 1024) fail("workspace_limit");
    const path = join(source, row.path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, row.content, { mode: 0o600, flag: "wx" });
  }
  const mounts = [];
  for (const [i, path] of p.write_paths.entries()) {
    const target = join(source, path),
      from = join(writes, String(i));
    if (existsSync(target) && lstatSync(target).isFile())
      copyFileSync(target, from);
    else {
      mkdirSync(target, { recursive: true, mode: 0o700 });
      mkdirSync(from, { mode: 0o700 });
      for (const row of files.filter((f) => within(f.path, [path]))) {
        const dest = join(from, row.path.slice(path.length + 1));
        mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
        writeFileSync(dest, row.content, { mode: 0o600, flag: "wx" });
      }
    }
    mounts.push({ path, source: from, target: "/work/" + path });
  }
  const w = Object.freeze({
    source,
    session: join(directory, "session"),
    mounts: Object.freeze(mounts.map(Object.freeze)),
    read_files_digest: hash(files),
    send_files_digest: hash(files.filter((f) => within(f.path, p.send_paths))),
  });
  workspaces.set(w, {
    profile: structuredClone(p),
    files: structuredClone(files),
    directory,
    bytes,
  });
  writeFileSync(
    join(directory, "workspace.json"),
    JSON.stringify({ profile_digest: hash(p), files }),
    { mode: 0o600, flag: "wx" },
  );
  return w;
}
export function collectArtifacts(w) {
  const data = workspaces.get(w);
  if (!data) fail("workspace_handle_invalid");
  const result = [];
  let bytes = 0,
    entries = 0;
  function visit(root, path, relative) {
    if (++entries > 20000 || relative.split("/").length > 32)
      fail("artifact_limit");
    const stat = lstatSync(path);
    if (
      stat.isSymbolicLink() ||
      (stat.isFile() && stat.nlink !== 1) ||
      stat.mode & 0o7000
    )
      fail("artifact_link_invalid");
    if (stat.isDirectory()) {
      const directory = opendirSync(path);
      try {
        let entry;
        while ((entry = directory.readSync()) !== null) {
          if (!pathValid(entry.name)) fail("artifact_path_invalid");
          visit(root, join(path, entry.name), relative + "/" + entry.name);
        }
      } finally {
        directory.closeSync();
      }
    } else {
      if (
        !stat.isFile() ||
        stat.size > 100 * 1024 * 1024 ||
        !pathValid(relative) ||
        !within(relative, data.profile.write_paths) ||
        overlap([relative], data.profile.forbidden_paths)
      )
        fail("artifact_scope_invalid");
      const content = readFileSync(path);
      bytes += content.length;
      if (bytes > 100 * 1024 * 1024 || result.length >= 10000)
        fail("artifact_limit");
      if (
        content.includes(0) ||
        !Buffer.from(content.toString("utf8"), "utf8").equals(content)
      )
        fail("artifact_format_unsupported");
      result.push({ path: relative, content: content.toString("utf8") });
    }
  }
  for (const m of w.mounts) visit(m.source, m.source, m.path);
  for (const old of data.files.filter((f) =>
    within(f.path, data.profile.write_paths),
  ))
    if (!result.some((f) => f.path === old.path))
      result.push({ path: old.path, deleted: true });
  result.sort((a, b) => a.path.localeCompare(b.path, "en"));
  return { files: result, digest: hash(result), bytes };
}
export function inspectWorkspace(w) {
  const data = workspaces.get(w);
  if (!data) fail("workspace_handle_invalid");
  return {
    ...data,
    profile: structuredClone(data.profile),
    files: structuredClone(data.files),
  };
}

export function restoreWorkspace({ directory, profile: p }) {
  if (
    directory !== resolve(directory) ||
    realpathSync(directory) !== directory ||
    !lstatSync(directory).isDirectory() ||
    lstatSync(directory).mode & 0o077
  )
    fail("workspace_invalid");
  const path = join(directory, "workspace.json"),
    stat = lstatSync(path);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.nlink !== 1 ||
    stat.size > 5 * 1024 * 1024
  )
    fail("workspace_invalid");
  const meta = JSON.parse(readFileSync(path, "utf8"));
  if (
    !safe(meta) ||
    meta.profile_digest !== hash(p) ||
    !Array.isArray(meta.files) ||
    meta.files.some(
      (f) =>
        !pathValid(f.path) ||
        !within(f.path, p.read_paths) ||
        !within(f.path, p.send_paths) ||
        /(^|\/)\.(codex|agents|ssh|aws)(\/|$)/i.test(f.path) ||
        within(f.path, p.forbidden_paths) ||
        typeof f.content !== "string",
    )
  )
    fail("workspace_binding_invalid");
  const shape = directories(directory, p);
  for (const path of [
    shape.source,
    shape.session,
    ...shape.mounts.map((m) => m.source),
  ])
    if (realpathSync(path) !== path || lstatSync(path).isSymbolicLink())
      fail("workspace_invalid");
  const w = Object.freeze({
    ...shape,
    read_files_digest: hash(meta.files),
    send_files_digest: hash(
      meta.files.filter((f) => within(f.path, p.send_paths)),
    ),
  });
  workspaces.set(w, {
    profile: structuredClone(p),
    files: meta.files,
    directory,
    bytes: meta.files.reduce((n, f) => n + Buffer.byteLength(f.content), 0),
  });
  return w;
}
