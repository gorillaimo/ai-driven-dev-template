"""Private fixed-command SQLite backend. No shell, arbitrary SQL or credentials."""

import datetime
import fcntl
import hashlib
import json
import os
import re
import sqlite3
import stat
import sys
import time

MAX_FRAME = 1024 * 1024
ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
DIGEST = re.compile(r"^[a-f0-9]{64}$")
SHA = re.compile(r"^[a-f0-9]{40}$")
STATES = {
    "reserved",
    "publishing",
    "ready",
    "running",
    "in_review",
    "blocked",
    "reconcile_required",
    "released",
}
KINDS = {
    "create_branch",
    "append_claim",
    "publish_commit",
    "append_record",
    "create_draft_pr",
    "update_draft_pr",
}


class Rejected(Exception):
    pass


def require(condition, code="request_invalid"):
    if not condition:
        raise Rejected(code)


def exact(value, keys):
    require(isinstance(value, dict) and set(value) == set(keys))


def compact(v):
    return json.dumps(v, separators=(",", ":"), sort_keys=True, ensure_ascii=False)


def load(s):
    def pairs(items):
        result = {}
        for k, v in items:
            require(k not in result)
            result[k] = v
        return result

    return json.loads(
        s,
        object_pairs_hook=pairs,
        parse_constant=lambda _: (_ for _ in ()).throw(Rejected("request_invalid")),
    )


def stamp(s):
    require(isinstance(s, str) and len(s) <= 40)
    d = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    require(d.tzinfo is not None)
    return s


def instant(s):
    stamp(s)
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def paths(v):
    require(isinstance(v, list) and len(v) <= 1000)
    for p in v:
        require(
            isinstance(p, str)
            and len(p) <= 1024
            and re.fullmatch(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*", p)
            and all(s.lower() not in {".", "..", ".git"} for s in p.split("/"))
        )
    require(len(v) == len(set(v)))
    return v


def inside(p, roots):
    return any(p == r or p.startswith(r + "/") for r in roots)


def overlap(a, b):
    return any(inside(p, b) for p in a) or any(inside(p, a) for p in b)


def private(path, directory=False):
    s = os.lstat(path)
    require(
        not stat.S_ISLNK(s.st_mode)
        and (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)),
        "storage_unsafe",
    )
    require(
        s.st_uid == os.getuid()
        and not s.st_mode & 0o077
        and (directory or s.st_nlink == 1),
        "storage_unsafe",
    )
    return s


def main():
    require(
        sys.platform == "linux"
        and sys.version_info >= (3, 11)
        and sqlite3.sqlite_version_info >= (3, 35),
        "backend_unsupported",
    )
    require(len(sys.argv) == 3, "backend_invalid")
    directory, source = sys.argv[1:]
    require(
        os.path.isabs(directory)
        and os.path.realpath(directory) == directory
        and os.path.commonpath([directory, source]) != source,
        "storage_unsafe",
    )
    private(directory, True)
    # Reject symlinks in any ancestor, rather than following them into storage.
    p = directory
    while p != "/":
        require(not stat.S_ISLNK(os.lstat(p).st_mode), "storage_unsafe")
        p = os.path.dirname(p)
    os.umask(0o077)
    lock_path = os.path.join(directory, "writer.lock")
    lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    lock_stat = private(lock_path)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise Rejected("writer_locked")
    db_path = os.path.join(directory, "ledger.sqlite")
    if not os.path.exists(db_path):
        fd = os.open(
            db_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
        )
        os.fsync(fd)
        os.close(fd)
    require(private(db_path).st_size <= 128 * 1024 * 1024, "ledger_limit")
    for suffix in ["-journal", "-wal", "-shm"]:
        if os.path.lexists(db_path + suffix):
            private(db_path + suffix)
    db = sqlite3.connect(db_path, isolation_level=None, timeout=1)
    db.execute("PRAGMA journal_mode=DELETE")
    db.execute("PRAGMA synchronous=FULL")
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA trusted_schema=OFF")
    db.execute("PRAGMA busy_timeout=1000")
    db.execute(
        "PRAGMA max_page_count="
        + str(128 * 1024 * 1024 // db.execute("PRAGMA page_size").fetchone()[0])
    )
    require(db.execute("PRAGMA quick_check").fetchone()[0] == "ok", "ledger_corrupt")
    version = db.execute("PRAGMA user_version").fetchone()[0]
    existing = {
        r[0]
        for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    }
    names = {
        "meta",
        "runs",
        "claims",
        "area_reservations",
        "execution_slots",
        "operations",
        "events",
    }
    require(
        (version == 0 and not existing) or (version == 1 and existing == names),
        "ledger_version_unknown",
    )
    first = sys.stdin.buffer.readline(MAX_FRAME + 1)
    require(first.endswith(b"\n") and len(first) <= MAX_FRAME, "frame_limit")
    init = load(first)
    exact(init, ["id", "command", "data"])
    require(init["id"] == 0 and init["command"] == "initialize")
    cfg = init["data"]
    exact(
        cfg,
        [
            "project_id",
            "configuration_digest",
            "owners",
            "active_owners",
            "areas",
            "parallel_limit",
            "run_limit",
        ],
    )
    require(
        ID.fullmatch(cfg["project_id"])
        and DIGEST.fullmatch(cfg["configuration_digest"])
        and 1 <= cfg["parallel_limit"] <= 2
        and 1 <= cfg["run_limit"] <= 10
    )
    require(
        isinstance(cfg["owners"], dict)
        and len(cfg["owners"]) <= 1000
        and all(
            isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= 10000
            for n in cfg["owners"].values()
        )
    )
    require(
        isinstance(cfg["active_owners"], list)
        and len(cfg["active_owners"]) == len(set(cfg["active_owners"]))
        and all(o in cfg["owners"] for o in cfg["active_owners"])
    )
    require(isinstance(cfg["areas"], list) and len(cfg["areas"]) <= 200)
    for a in cfg["areas"]:
        exact(a, ["area_id", "paths", "shared", "integration_owner", "conflict_policy"])
        paths(a["paths"])
    db.execute("BEGIN IMMEDIATE")
    if version == 0:
        for sql in [
            "CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
            "CREATE TABLE runs(id TEXT PRIMARY KEY,data TEXT NOT NULL)",
            "CREATE TABLE claims(id TEXT PRIMARY KEY,operation_id TEXT UNIQUE NOT NULL,issue INTEGER NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,request_digest TEXT NOT NULL)",
            "CREATE UNIQUE INDEX one_active_issue ON claims(issue) WHERE status != 'released'",
            "CREATE TABLE area_reservations(claim_id TEXT NOT NULL REFERENCES claims(id),area_id TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(claim_id,area_id,path))",
            "CREATE TABLE execution_slots(claim_id TEXT PRIMARY KEY REFERENCES claims(id))",
            "CREATE TABLE operations(id TEXT PRIMARY KEY,claim_id TEXT NOT NULL REFERENCES claims(id),status TEXT NOT NULL,data TEXT NOT NULL)",
            "CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,subject TEXT NOT NULL,digest TEXT NOT NULL)",
        ]:
            db.execute(sql)
        db.execute("PRAGMA user_version=1")
        for k, v in {
            "configuration": cfg,
            "epoch": 0,
            "migration": None,
            "recovery": False,
        }.items():
            db.execute("INSERT INTO meta VALUES(?,?)", (k, compact(v)))

    def meta(key):
        row = db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        require(row is not None, "ledger_corrupt")
        return load(row[0])

    def set_meta(key, value):
        db.execute("UPDATE meta SET value=? WHERE key=?", (compact(value), key))

    require(meta("configuration") == cfg, "configuration_changed")
    require(not db.execute("PRAGMA foreign_key_check").fetchall(), "ledger_corrupt")
    expected_areas, expected_slots = set(), set()
    for claim_id, operation_id, issue, status, data in db.execute(
        "SELECT id,operation_id,issue,status,data FROM claims"
    ):
        c = load(data)
        require(
            (c["claim_id"], c["operation_id"], c["issue_number"], c["status"])
            == (claim_id, operation_id, issue, status)
            and status in STATES
            and isinstance(c["execution_active"], bool),
            "ledger_corrupt",
        )
        require(status != "released" or not c["execution_active"], "ledger_corrupt")
        if status != "released":
            expected_areas.update(
                (claim_id, a, p) for a in c["areas"] for p in c["allowed_paths"]
            )
        if c["execution_active"]:
            expected_slots.add((claim_id,))
    require(
        expected_areas
        == set(db.execute("SELECT claim_id,area_id,path FROM area_reservations"))
        and expected_slots == set(db.execute("SELECT claim_id FROM execution_slots")),
        "ledger_corrupt",
    )
    for operation_id, claim_id, status, data in db.execute(
        "SELECT id,claim_id,status,data FROM operations"
    ):
        o = load(data)
        require(
            (o["operation_id"], o["claim_id"], o["status"])
            == (operation_id, claim_id, status)
            and status in {"sending", "unknown", "confirmed", "failed"},
            "ledger_corrupt",
        )
    epoch = meta("epoch") + 1
    require(isinstance(epoch, int) and epoch < 9007199254740991, "ledger_corrupt")
    set_meta("epoch", epoch)
    if (
        db.execute("SELECT count(*) FROM claims WHERE status!='released'").fetchone()[0]
        or db.execute(
            "SELECT count(*) FROM operations WHERE status IN ('sending','unknown')"
        ).fetchone()[0]
    ):
        set_meta("recovery", True)
    db.commit()
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    os.fsync(fd)
    os.close(fd)

    def rows(table, condition="1"):
        # table/condition are fixed literals from this program, never RPC input.
        return [
            load(r[0])
            for r in db.execute(
                "SELECT data FROM " + table + " WHERE " + condition + " ORDER BY rowid"
            )
        ]

    def check_lock():
        s = private(lock_path)
        require(
            (s.st_dev, s.st_ino) == (lock_stat.st_dev, lock_stat.st_ino)
            and meta("epoch") == epoch,
            "writer_lost",
        )

    def count(table):
        return db.execute("SELECT count(*) FROM " + table).fetchone()[0]

    def event(kind, subject, value):
        require(count("events") < 100000, "ledger_limit")
        db.execute(
            "INSERT INTO events(kind,subject,digest) VALUES(?,?,?)",
            (kind, subject, hashlib.sha256(compact(value).encode()).hexdigest()),
        )

    def save(c):
        db.execute(
            "UPDATE claims SET status=?,data=? WHERE id=?",
            (c["status"], compact(c), c["claim_id"]),
        )

    def release_resources(c):
        db.execute("DELETE FROM execution_slots WHERE claim_id=?", (c["claim_id"],))
        db.execute("DELETE FROM area_reservations WHERE claim_id=?", (c["claim_id"],))

    def get_claim(q):
        row = db.execute(
            "SELECT data FROM claims WHERE id=?", (q["claim_id"],)
        ).fetchone()
        require(row is not None, "claim_missing")
        c = load(row[0])
        require(
            c["generation"] == q["generation"] == epoch
            and c["worker_id"] == q["worker_id"]
            and c["status"] != "released"
            and not meta("recovery"),
            "claim_generation_invalid",
        )
        return c

    def view():
        runs = [
            {
                "run_id": key,
                "issues_count": r["count"],
                "issue_limit": r["limit"],
                "profile_digest": r["profile_digest"],
                "stopped": r["stopped"],
                "expires_at": r["expires_at"],
            }
            for key, data in db.execute("SELECT id,data FROM runs ORDER BY id")
            for r in [load(data)]
        ]
        return {
            "schema_version": 1,
            "artifact_kind": "ledger-view",
            "project_id": cfg["project_id"],
            "configuration_digest": cfg["configuration_digest"],
            "generation": epoch,
            "status": (
                "unmigrated"
                if meta("migration") is None
                else "recovery_required" if meta("recovery") else "ready"
            ),
            "complete": True,
            "claims": rows("claims", "status!='released'"),
            "pending_operations": rows("operations", "status IN ('sending','unknown')"),
            "runs": runs,
            "history": {
                k: count(t)
                for k, t in [
                    ("claims", "claims"),
                    ("operations", "operations"),
                    ("events", "events"),
                ]
            },
        }

    def insert_claim(c, request_digest=None):
        require(count("claims") < 10000, "ledger_limit")
        db.execute(
            "INSERT INTO claims VALUES(?,?,?,?,?,?)",
            (
                c["claim_id"],
                c["operation_id"],
                c["issue_number"],
                c["status"],
                compact(c),
                request_digest or hashlib.sha256(compact(c).encode()).hexdigest(),
            ),
        )
        if c["status"] != "released":
            for area in c["areas"]:
                for path in c["allowed_paths"]:
                    db.execute(
                        "INSERT INTO area_reservations VALUES(?,?,?)",
                        (c["claim_id"], area, path),
                    )
        if c["execution_active"]:
            db.execute("INSERT INTO execution_slots VALUES(?)", (c["claim_id"],))

    def command(cmd, q):
        check_lock()
        if cmd == "view":
            exact(q, [])
            return view()
        if cmd == "close":
            exact(q, [])
            return {"closed": True}
        if cmd == "migrate":
            exact(q, ["manifest_digest", "claims", "now"])
            stamp(q["now"])
            require(
                DIGEST.fullmatch(q["manifest_digest"])
                and isinstance(q["claims"], list)
                and len(q["claims"]) <= 10000
            )
            if meta("migration") is not None:
                require(meta("migration") == q["manifest_digest"], "migration_conflict")
                return view()
            for c in q["claims"]:
                require(
                    c["origin"] == "manual-v1"
                    and c["human_owner"] in cfg["owners"]
                    and c["status"] in STATES,
                    "migration_invalid",
                )
                paths(c["allowed_paths"])
                paths(c["forbidden_paths"])
                known = {a["area_id"] for a in cfg["areas"]}
                require(
                    c["areas"]
                    and len(c["areas"]) == len(set(c["areas"]))
                    and set(c["areas"]) <= known
                    and c["allowed_paths"]
                    and all(
                        a["area_id"] in c["areas"]
                        for a in cfg["areas"]
                        if (a["shared"] or a["conflict_policy"] == "serialize")
                        and overlap(c["allowed_paths"], a["paths"])
                    ),
                    "migration_invalid",
                )
                require(
                    c["status"] != "released" or not c["execution_active"],
                    "migration_invalid",
                )
                insert_claim(c)
            set_meta("migration", q["manifest_digest"])
            event("migration", cfg["project_id"], q)
            return view()
        require(meta("migration") is not None, "migration_required")
        if cmd == "reserve":
            exact(
                q,
                [
                    "operation_id",
                    "input_digest",
                    "run_id",
                    "claim_id",
                    "worker_id",
                    "task",
                    "run_limit",
                    "execution_limit",
                    "expires_at",
                    "now",
                ],
            )
            for k in ["operation_id", "run_id", "claim_id", "worker_id"]:
                require(isinstance(q[k], str) and ID.fullmatch(q[k]))
            require(DIGEST.fullmatch(q["input_digest"]))
            stamp(q["now"])
            require(not meta("recovery"), "recovery_required")
            fingerprint = hashlib.sha256(
                compact({k: v for k, v in q.items() if k != "now"}).encode()
            ).hexdigest()
            previous = db.execute(
                "SELECT data,request_digest FROM claims WHERE operation_id=?",
                (q["operation_id"],),
            ).fetchone()
            if previous:
                c = load(previous[0])
                require(
                    previous[1] == fingerprint
                    and c["input_digest"] == q["input_digest"]
                    and c["run_id"] == q["run_id"]
                    and c["claim_id"] == q["claim_id"]
                    and c["worker_id"] == q["worker_id"],
                    "operation_conflict",
                )
                return c
            t = q["task"]
            exact(
                t,
                [
                    "issue_number",
                    "feature_id",
                    "human_owner",
                    "areas",
                    "allowed_paths",
                    "forbidden_paths",
                    "head_sha",
                    "profile_digest",
                    "grant_digest",
                    "contract_digest",
                    "design_digest",
                    "stages",
                ],
            )
            require(
                isinstance(t["issue_number"], int)
                and not isinstance(t["issue_number"], bool)
                and t["issue_number"] > 0
                and t["human_owner"] in cfg["active_owners"]
            )
            require(
                SHA.fullmatch(t["head_sha"])
                and all(
                    DIGEST.fullmatch(t[k])
                    for k in [
                        "profile_digest",
                        "grant_digest",
                        "contract_digest",
                        "design_digest",
                    ]
                )
            )
            paths(t["allowed_paths"])
            paths(t["forbidden_paths"])
            areas = {a["area_id"]: a for a in cfg["areas"]}
            require(
                t["areas"]
                and len(t["areas"]) == len(set(t["areas"]))
                and all(a in areas for a in t["areas"])
                and t["allowed_paths"]
                and all(
                    any(inside(p, areas[a]["paths"]) for a in t["areas"])
                    and not inside(p, t["forbidden_paths"])
                    for p in t["allowed_paths"]
                ),
                "scope_invalid",
            )
            require(
                all(
                    a["area_id"] in t["areas"]
                    for a in cfg["areas"]
                    if (a["shared"] or a["conflict_policy"] == "serialize")
                    and overlap(t["allowed_paths"], a["paths"])
                ),
                "scope_invalid",
            )
            active = rows("claims", "status!='released'")
            require(
                all(c["issue_number"] != t["issue_number"] for c in active),
                "issue_reserved",
            )
            require(
                all(
                    not overlap(t["allowed_paths"], c["allowed_paths"])
                    and not any(
                        a in c["areas"]
                        and (
                            areas[a]["shared"]
                            or areas[a]["conflict_policy"] == "serialize"
                        )
                        for a in t["areas"]
                    )
                    for c in active
                ),
                "area_reserved",
            )
            require(
                sum(c["human_owner"] == t["human_owner"] for c in active)
                < cfg["owners"][t["human_owner"]],
                "owner_capacity",
            )
            require(
                isinstance(q["execution_limit"], int)
                and 1 <= q["execution_limit"] <= cfg["parallel_limit"]
                and count("execution_slots") < q["execution_limit"],
                "execution_capacity",
            )
            row = db.execute(
                "SELECT data FROM runs WHERE id=?", (q["run_id"],)
            ).fetchone()
            stamp(q["expires_at"])
            run = (
                load(row[0])
                if row
                else {
                    "count": 0,
                    "limit": min(cfg["run_limit"], q["run_limit"]),
                    "profile_digest": t["profile_digest"],
                    "stopped": False,
                    "expires_at": q["expires_at"],
                }
            )
            require(
                instant(run["expires_at"]) > instant(q["now"])
                and instant(q["expires_at"]) > instant(q["now"])
                and instant(q["expires_at"]) - instant(q["now"]) <= 21600,
                "run_expired",
            )
            require(
                isinstance(q["run_limit"], int)
                and 1 <= q["run_limit"] <= cfg["run_limit"]
                and not run["stopped"]
                and run["profile_digest"] == t["profile_digest"]
                and run["count"] < min(run["limit"], q["run_limit"]),
                "run_limit",
            )
            run["count"] += 1
            run["limit"] = min(run["limit"], q["run_limit"])
            run["expires_at"] = min([run["expires_at"], q["expires_at"]], key=instant)
            run["execution_limit"] = min(
                run.get("execution_limit", q["execution_limit"]), q["execution_limit"]
            )
            db.execute(
                "INSERT OR REPLACE INTO runs VALUES(?,?)", (q["run_id"], compact(run))
            )
            c = {
                "claim_id": q["claim_id"],
                "operation_id": q["operation_id"],
                "input_digest": q["input_digest"],
                "run_id": q["run_id"],
                "worker_id": q["worker_id"],
                "generation": epoch,
                "issue_number": t["issue_number"],
                "human_owner": t["human_owner"],
                "areas": t["areas"],
                "allowed_paths": t["allowed_paths"],
                "forbidden_paths": t["forbidden_paths"],
                "status": "reserved",
                "reserved_at": q["now"],
                "updated_at": q["now"],
                "head_sha": t["head_sha"],
                "execution_active": True,
                "profile_digest": t["profile_digest"],
                "grant_digest": t["grant_digest"],
                "origin": "dispatcher",
            }
            c.update(
                feature_id=t["feature_id"],
                contract_digest=t["contract_digest"],
                design_digest=t["design_digest"],
                stages=t["stages"],
                branch=None,
                policy_digest=None,
            )
            insert_claim(c, fingerprint)
            event("reserved", c["claim_id"], c)
            return c
        if cmd == "operations":
            exact(q, ["claim_id"])
            return [
                load(row[0])
                for row in db.execute(
                    "SELECT data FROM operations WHERE claim_id=? ORDER BY rowid",
                    (q["claim_id"],),
                )
            ]
        if cmd == "bind_authority":
            exact(q, ["claim_id", "worker_id", "generation", "branch", "policy_digest"])
            c = get_claim(q)
            require(
                isinstance(q["branch"], str)
                and DIGEST.fullmatch(q["policy_digest"])
                and (c["branch"] is None or c["branch"] == q["branch"])
                and (
                    c["policy_digest"] is None
                    or c["policy_digest"] == q["policy_digest"]
                ),
                "authority_binding_changed",
            )
            paths([q["branch"]])
            c.update(branch=q["branch"], policy_digest=q["policy_digest"])
            save(c)
            return c
        if cmd == "transition":
            exact(
                q,
                [
                    "claim_id",
                    "worker_id",
                    "generation",
                    "status",
                    "head_sha",
                    "execution_stopped",
                    "now",
                ],
            )
            c = get_claim(q)
            stamp(q["now"])
            require(
                q["status"] in STATES
                and SHA.fullmatch(q["head_sha"])
                and isinstance(q["execution_stopped"], bool)
            )
            if q["status"] in {"running", "ready"}:
                run_row = db.execute(
                    "SELECT data FROM runs WHERE id=?", (c["run_id"],)
                ).fetchone()
                require(run_row is not None, "run_missing")
                run = load(run_row[0])
                require(
                    not run["stopped"]
                    and instant(run["expires_at"]) > instant(q["now"])
                    and not q["execution_stopped"],
                    "run_stopped",
                )
                if not c["execution_active"]:
                    require(
                        count("execution_slots")
                        < min(cfg["parallel_limit"], run["execution_limit"]),
                        "execution_capacity",
                    )
                    db.execute(
                        "INSERT INTO execution_slots VALUES(?)", (c["claim_id"],)
                    )
                    c["execution_active"] = True
            require(
                q["status"] != "released" or q["execution_stopped"],
                "worker_stop_required",
            )
            require(
                not db.execute(
                    "SELECT 1 FROM operations WHERE claim_id=? AND status IN ('sending','unknown')",
                    (c["claim_id"],),
                ).fetchone(),
                "operation_unresolved",
            )
            c.update(status=q["status"], head_sha=q["head_sha"], updated_at=q["now"])
            if q["execution_stopped"]:
                c["execution_active"] = False
                db.execute(
                    "DELETE FROM execution_slots WHERE claim_id=?", (c["claim_id"],)
                )
            if c["status"] == "released":
                release_resources(c)
            save(c)
            event("transition", c["claim_id"], q)
            return c
        if cmd == "begin_operation":
            exact(
                q,
                [
                    "claim_id",
                    "worker_id",
                    "generation",
                    "operation_id",
                    "input_digest",
                    "kind",
                    "actor_id",
                    "now",
                ],
            )
            c = get_claim(q)
            stamp(q["now"])
            run_row = db.execute(
                "SELECT data FROM runs WHERE id=?", (c["run_id"],)
            ).fetchone()
            require(
                run_row is not None
                and not load(run_row[0])["stopped"]
                and instant(load(run_row[0])["expires_at"]) > instant(q["now"]),
                "run_stopped",
            )
            require(
                ID.fullmatch(q["operation_id"])
                and DIGEST.fullmatch(q["input_digest"])
                and q["kind"] in KINDS
                and isinstance(q["actor_id"], int)
                and q["actor_id"] > 0
            )
            require(
                not db.execute(
                    "SELECT 1 FROM operations WHERE status IN ('sending','unknown')"
                ).fetchone(),
                "operation_unresolved",
            )
            old = db.execute(
                "SELECT data FROM operations WHERE id=?", (q["operation_id"],)
            ).fetchone()
            if old:
                o = load(old[0])
                require(
                    o["input_digest"] == q["input_digest"]
                    and o["claim_id"] == c["claim_id"]
                    and o["kind"] == q["kind"]
                    and o["actor_id"] == q["actor_id"],
                    "operation_conflict",
                )
                return o
            require(count("operations") < 100000, "ledger_limit")
            o = {
                "operation_id": q["operation_id"],
                "claim_id": c["claim_id"],
                "input_digest": q["input_digest"],
                "kind": q["kind"],
                "status": "sending",
                "receipt_digest": None,
                "actor_id": q["actor_id"],
            }
            db.execute(
                "INSERT INTO operations VALUES(?,?,?,?)",
                (o["operation_id"], c["claim_id"], "sending", compact(o)),
            )
            c["status"] = "publishing"
            save(c)
            event("sending", o["operation_id"], o)
            return o
        if cmd == "finish_operation":
            exact(
                q,
                [
                    "claim_id",
                    "worker_id",
                    "generation",
                    "operation_id",
                    "input_digest",
                    "status",
                    "receipt_digest",
                    "now",
                ],
            )
            c = get_claim(q)
            stamp(q["now"])
            row = db.execute(
                "SELECT data FROM operations WHERE id=?", (q["operation_id"],)
            ).fetchone()
            require(row is not None, "operation_missing")
            o = load(row[0])
            require(
                o["claim_id"] == c["claim_id"]
                and o["input_digest"] == q["input_digest"]
                and q["status"] in {"confirmed", "failed", "unknown"}
                and (
                    q["receipt_digest"] is None or DIGEST.fullmatch(q["receipt_digest"])
                ),
                "operation_conflict",
            )
            require(
                o["status"] in {"sending", "unknown"}
                or (
                    o["status"] == q["status"]
                    and o["receipt_digest"] == q["receipt_digest"]
                ),
                "operation_conflict",
            )
            o.update(status=q["status"], receipt_digest=q["receipt_digest"])
            db.execute(
                "UPDATE operations SET status=?,data=? WHERE id=?",
                (o["status"], compact(o), o["operation_id"]),
            )
            if o["status"] == "unknown":
                c["status"] = "reconcile_required"
                save(c)
            event("receipt", o["operation_id"], o)
            return o
        if cmd == "stop_run":
            exact(q, ["run_id", "now"])
            stamp(q["now"])
            row = db.execute(
                "SELECT data FROM runs WHERE id=?", (q["run_id"],)
            ).fetchone()
            require(row is not None, "run_missing")
            run = load(row[0])
            run["stopped"] = True
            db.execute("UPDATE runs SET data=? WHERE id=?", (compact(run), q["run_id"]))
            event("stop", q["run_id"], run)
            return {"stopped": True}
        if cmd == "reconcile":
            exact(q, ["claims", "operations", "now"])
            stamp(q["now"])
            old_claims = rows("claims", "status!='released'")
            pending = rows("operations", "status IN ('sending','unknown')")
            require(
                {c["claim_id"] for c in old_claims}
                == {c["claim_id"] for c in q["claims"]}
                and len(old_claims) == len(q["claims"])
                and {o["operation_id"] for o in pending}
                == {o["operation_id"] for o in q["operations"]}
                and len(pending) == len(q["operations"]),
                "recovery_incomplete",
            )
            for p in q["operations"]:
                exact(p, ["operation_id", "status", "receipt_digest"])
                require(
                    p["status"] in {"confirmed", "failed"}
                    and DIGEST.fullmatch(p["receipt_digest"]),
                    "recovery_incomplete",
                )
                o = next(o for o in pending if o["operation_id"] == p["operation_id"])
                o.update(status=p["status"], receipt_digest=p["receipt_digest"])
                db.execute(
                    "UPDATE operations SET status=?,data=? WHERE id=?",
                    (o["status"], compact(o), o["operation_id"]),
                )
            for p in q["claims"]:
                exact(
                    p, ["claim_id", "old_generation", "action", "worker_id", "head_sha"]
                )
                c = next(c for c in old_claims if c["claim_id"] == p["claim_id"])
                require(
                    c["generation"] == p["old_generation"]
                    and p["action"] in {"retain", "resume", "release"}
                    and ID.fullmatch(p["worker_id"])
                    and SHA.fullmatch(p["head_sha"]),
                    "recovery_incomplete",
                )
                c.update(
                    generation=epoch,
                    worker_id=p["worker_id"],
                    head_sha=p["head_sha"],
                    updated_at=q["now"],
                    execution_active=False,
                    status=(
                        "released"
                        if p["action"] == "release"
                        else "reserved" if p["action"] == "resume" else "blocked"
                    ),
                )
                db.execute(
                    "DELETE FROM execution_slots WHERE claim_id=?", (c["claim_id"],)
                )
                if c["status"] == "released":
                    release_resources(c)
                save(c)
            set_meta("recovery", False)
            event("reconcile", cfg["project_id"], q)
            return view()
        raise Rejected("command_invalid")

    def emit(message):
        raw = compact(message).encode()
        require(len(raw) <= MAX_FRAME, "output_limit")
        sys.stdout.buffer.write(raw + b"\n")
        sys.stdout.buffer.flush()

    emit({"id": 0, "ok": True, "value": {"generation": epoch}})
    for raw in iter(lambda: sys.stdin.buffer.readline(MAX_FRAME + 1), b""):
        req_id = None
        try:
            require(raw.endswith(b"\n") and len(raw) <= MAX_FRAME, "frame_limit")
            req = load(raw)
            exact(req, ["id", "command", "data"])
            req_id = req["id"]
            require(
                isinstance(req_id, int)
                and not isinstance(req_id, bool)
                and req_id > 0
                and isinstance(req["command"], str)
            )
            deadline = time.monotonic() + 5
            db.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
            db.execute("BEGIN IMMEDIATE")
            value = command(req["command"], req["data"])
            require(
                len(compact({"id": req_id, "ok": True, "value": value}).encode())
                <= MAX_FRAME,
                "output_limit",
            )
            db.commit()
            emit({"id": req_id, "ok": True, "value": value})
            if req["command"] == "close":
                break
        except Exception as e:
            if db.in_transaction:
                db.rollback()
            error = str(e) if isinstance(e, Rejected) else "ledger_unavailable"
            emit({"id": req_id, "ok": False, "error": error})
            if error == "frame_limit":
                break
    db.close()
    os.close(lock_fd)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(
            compact(
                {
                    "id": 0,
                    "ok": False,
                    "error": (
                        str(e) if isinstance(e, Rejected) else "ledger_unavailable"
                    ),
                }
            ),
            flush=True,
        )
        sys.exit(2)
