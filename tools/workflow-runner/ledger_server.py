"""Private bounded RPC; fixed SQLite statements, one Linux writer, no credentials."""

import datetime, fcntl, hashlib, json, os, re, sqlite3, stat, sys, time

MAX = 1048576
ID = re.compile(r"^[a-z0-9]+(?:[-_][a-z0-9]+)*$")
HEX = re.compile(r"^[a-f0-9]{64}$")


class Rejected(Exception):
    pass


def require(ok, code="request_invalid"):
    if not ok:
        raise Rejected(code)


def exact(q, keys):
    require(isinstance(q, dict) and set(q) == set(keys))


def encoded(q):
    return json.dumps(q, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def load(q):
    def pairs(rows):
        r = {}
        for k, v in rows:
            require(k not in r)
            r[k] = v
        return r

    return json.loads(
        q, object_pairs_hook=pairs, parse_constant=lambda _: require(False)
    )


def digest(q):
    return hashlib.sha256(encoded(q).encode()).hexdigest()


def instant(q):
    require(isinstance(q, str) and len(q) <= 40)
    d = datetime.datetime.fromisoformat(q.replace("Z", "+00:00"))
    require(d.tzinfo is not None)
    return d.timestamp()


def identifier(q):
    require(isinstance(q, str) and len(q) <= 128 and ID.fullmatch(q))


def private(p, directory=False):
    s = os.lstat(p)
    require(
        s.st_uid == os.getuid()
        and not s.st_mode & 0o077
        and not stat.S_ISLNK(s.st_mode)
        and (
            stat.S_ISDIR(s.st_mode)
            if directory
            else stat.S_ISREG(s.st_mode) and s.st_nlink == 1
        ),
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
    require(len(sys.argv) == 3)
    directory, source = sys.argv[1:]
    require(
        os.path.isabs(directory)
        and os.path.realpath(directory) == directory
        and os.path.commonpath([directory, source]) != source,
        "storage_unsafe",
    )
    private(directory, True)
    os.umask(0o077)
    lock = os.path.join(directory, "writer.lock")
    fd = os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    initial = private(lock)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise Rejected("writer_locked")
    path = os.path.join(directory, "runner.sqlite")
    if not os.path.exists(path):
        f = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        os.fsync(f)
        os.close(f)
    require(private(path).st_size <= 128 * 1024 * 1024, "storage_limit")
    for ext in ["-journal", "-wal", "-shm"]:
        if os.path.lexists(path + ext):
            private(path + ext)
    db = sqlite3.connect(path, isolation_level=None, timeout=1)
    for sql in [
        "PRAGMA journal_mode=DELETE",
        "PRAGMA synchronous=FULL",
        "PRAGMA foreign_keys=ON",
        "PRAGMA trusted_schema=OFF",
        "PRAGMA busy_timeout=1000",
        "PRAGMA max_page_count=32768",
    ]:
        db.execute(sql)
    require(db.execute("PRAGMA quick_check").fetchone()[0] == "ok", "ledger_corrupt")
    first = load(sys.stdin.buffer.readline(MAX + 1))
    exact(first, ["id", "command", "data"])
    require(first["id"] == 0 and first["command"] == "initialize")
    cfg = first["data"]
    exact(cfg, ["profile_digest", "profile"])
    p = cfg["profile"]
    lim = p["limits"]
    model = p["model"]
    require(HEX.fullmatch(cfg["profile_digest"]))
    names = {
        r[0]
        for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    }
    version = db.execute("PRAGMA user_version").fetchone()[0]
    require(
        (version == 0 and not names)
        or (
            version == 1
            and names == {"meta", "runs", "attempts", "usage", "requests", "events"}
        ),
        "ledger_version_unknown",
    )
    db.execute("BEGIN IMMEDIATE")
    if version == 0:
        for sql in [
            "CREATE TABLE meta(key TEXT PRIMARY KEY,data TEXT NOT NULL)",
            "CREATE TABLE runs(id TEXT PRIMARY KEY,data TEXT NOT NULL)",
            "CREATE TABLE attempts(id TEXT PRIMARY KEY,run TEXT REFERENCES runs(id),claim TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL,data TEXT NOT NULL,request_digest TEXT NOT NULL)",
            "CREATE UNIQUE INDEX one_active_claim_role ON attempts(claim,role) WHERE active=1",
            "CREATE TABLE usage(id TEXT PRIMARY KEY,attempt TEXT REFERENCES attempts(id),status TEXT NOT NULL,data TEXT NOT NULL,request_digest TEXT NOT NULL)",
            "CREATE TABLE requests(id TEXT PRIMARY KEY,nonce TEXT UNIQUE NOT NULL,digest TEXT NOT NULL)",
            "CREATE TABLE events(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,digest TEXT NOT NULL)",
        ]:
            db.execute(sql)
        db.execute("PRAGMA user_version=1")
        for k, v in {"configuration": cfg, "epoch": 0, "recovery": False}.items():
            db.execute("INSERT INTO meta VALUES(?,?)", (k, encoded(v)))

    def meta(k):
        row = db.execute("SELECT data FROM meta WHERE key=?", (k,)).fetchone()
        require(row is not None, "ledger_corrupt")
        return load(row[0])

    def put_meta(k, v):
        db.execute("UPDATE meta SET data=? WHERE key=?", (encoded(v), k))

    require(meta("configuration") == cfg, "configuration_changed")
    require(not db.execute("PRAGMA foreign_key_check").fetchall(), "ledger_corrupt")
    for key, run, claim, role, active, data, _ in db.execute("SELECT * FROM attempts"):
        a = load(data)
        require(
            (a["attempt_id"], a["run_id"], a["claim_id"], a["role"], not a["stopped"])
            == (key, run, claim, role, bool(active)),
            "ledger_corrupt",
        )
    epoch = meta("epoch") + 1
    put_meta("epoch", epoch)
    if (
        db.execute("SELECT 1 FROM attempts WHERE active=1").fetchone()
        or db.execute(
            "SELECT 1 FROM usage WHERE status IN ('reserved','unknown')"
        ).fetchone()
    ):
        put_meta("recovery", True)
        for key, data in db.execute(
            "SELECT id,data FROM usage WHERE status='reserved'"
        ).fetchall():
            u = load(data)
            u["status"] = "unknown"
            db.execute(
                "UPDATE usage SET status='unknown',data=? WHERE id=?", (encoded(u), key)
            )
    db.commit()
    d = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    os.fsync(d)
    os.close(d)

    def rows(table):
        return [
            load(r[0])
            for r in db.execute("SELECT data FROM " + table + " ORDER BY rowid")
        ]

    def count(table):
        return db.execute("SELECT count(*) FROM " + table).fetchone()[0]

    def event(kind, q):
        require(count("events") < 100000, "ledger_limit")
        db.execute("INSERT INTO events(kind,digest) VALUES(?,?)", (kind, digest(q)))

    def run(key):
        row = db.execute("SELECT data FROM runs WHERE id=?", (key,)).fetchone()
        require(row is not None, "run_missing")
        return load(row[0])

    def save_run(r):
        db.execute("UPDATE runs SET data=? WHERE id=?", (encoded(r), r["run_id"]))

    def attempt(q):
        require(q["epoch"] == epoch and not meta("recovery"), "generation_invalid")
        row = db.execute(
            "SELECT data FROM attempts WHERE id=?", (q["attempt_id"],)
        ).fetchone()
        require(row is not None, "attempt_missing")
        a = load(row[0])
        require(not a["stopped"], "attempt_stopped")
        return a

    def require_running(r, now):
        require(
            not r["stopped"]
            and instant(r["expires_at"]) > instant(now)
            and not meta("recovery"),
            "run_stopped",
        )

    def rpc(cmd, q):
        s = private(lock)
        require(
            (s.st_ino, s.st_dev) == (initial.st_ino, initial.st_dev)
            and meta("epoch") == epoch,
            "writer_lost",
        )
        if cmd in {"view", "close"}:
            exact(q, [])
            return {
                "epoch": epoch,
                "recovery_required": meta("recovery"),
                "runs": rows("runs"),
                "attempts": rows("attempts"),
                "usage": rows("usage"),
            }
        if cmd == "admit":
            exact(q, ["event_id", "nonce", "run_id", "intent", "request_digest", "now"])
            for k in ["event_id", "nonce", "run_id"]:
                identifier(q[k])
            require(
                q["intent"] in {"continue", "stop"}
                and HEX.fullmatch(q["request_digest"])
            )
            instant(q["now"])
            old = db.execute(
                "SELECT nonce,digest FROM requests WHERE id=?", (q["event_id"],)
            ).fetchone()
            if old:
                require(old == (q["nonce"], q["request_digest"]), "request_replayed")
                return {**run(q["run_id"]), "duplicate": True}
            require(count("requests") < 100000, "ledger_limit")
            db.execute(
                "INSERT INTO requests VALUES(?,?,?)",
                (q["event_id"], q["nonce"], q["request_digest"]),
            )
            row = db.execute(
                "SELECT data FROM runs WHERE id=?", (q["run_id"],)
            ).fetchone()
            if row:
                r = load(row[0])
            else:
                require(not meta("recovery"), "recovery_required")
                r = {
                    "run_id": q["run_id"],
                    "profile_digest": cfg["profile_digest"],
                    "started_at": q["now"],
                    "expires_at": datetime.datetime.fromtimestamp(
                        instant(q["now"]) + lim["run_seconds"], datetime.timezone.utc
                    ).isoformat(),
                    "stopped": q["intent"] == "stop",
                    "spent": 0,
                    "requests": 0,
                }
                db.execute("INSERT INTO runs VALUES(?,?)", (r["run_id"], encoded(r)))
            if q["intent"] == "stop":
                r["stopped"] = True
                save_run(r)
            event("admit", q)
            return r
        if cmd == "fence":
            exact(q, ["run_id", "now"])
            instant(q["now"])
            r = run(q["run_id"])
            r["stopped"] = True
            save_run(r)
            event("fence", q)
            return {"stopped": True}
        if cmd == "resume_run":
            exact(q, ["run_id", "now"])
            r = run(q["run_id"])
            require(
                not meta("recovery")
                and instant(r["expires_at"]) > instant(q["now"])
                and not db.execute(
                    "SELECT 1 FROM attempts WHERE active=1 AND run=?", (q["run_id"],)
                ).fetchone()
                and not db.execute(
                    "SELECT 1 FROM usage WHERE status IN ('reserved','unknown')"
                ).fetchone(),
                "recovery_required",
            )
            r["stopped"] = False
            save_run(r)
            event("resume", q)
            return r
        if cmd == "reserve":
            exact(
                q,
                [
                    "attempt_id",
                    "run_id",
                    "claim_id",
                    "worker_id",
                    "generation",
                    "issue_number",
                    "role",
                    "context_id",
                    "head_sha",
                    "now",
                ],
            )
            for k in ["attempt_id", "run_id", "claim_id", "worker_id", "context_id"]:
                identifier(q[k])
            require(
                isinstance(q["generation"], int)
                and not isinstance(q["generation"], bool)
                and q["generation"] > 0
                and isinstance(q["issue_number"], int)
                and q["issue_number"] > 0
                and q["role"] in {"implementation", "review", "verification"}
                and re.fullmatch(r"[a-f0-9]{40}", q["head_sha"])
            )
            r = run(q["run_id"])
            require_running(r, q["now"])
            fingerprint = digest({k: v for k, v in q.items() if k != "now"})
            old = db.execute(
                "SELECT data,request_digest FROM attempts WHERE id=?",
                (q["attempt_id"],),
            ).fetchone()
            if old:
                require(old[1] == fingerprint, "attempt_replayed")
                return {**load(old[0]), "epoch": epoch}
            require(
                not any(a["context_id"] == q["context_id"] for a in rows("attempts")),
                "context_reused",
            )
            require(
                count("attempts") < 10000
                and db.execute(
                    "SELECT count(*) FROM attempts WHERE active=1"
                ).fetchone()[0]
                < lim["max_ai_workers"],
                "worker_capacity",
            )
            issues = {
                a["issue_number"]
                for a in rows("attempts")
                if a["run_id"] == q["run_id"]
            }
            require(q["issue_number"] in issues or len(issues) < 10, "run_issue_limit")
            a = {
                "schema_version": 1,
                "artifact_kind": "runner-attempt",
                **{
                    k: q[k]
                    for k in [
                        "attempt_id",
                        "run_id",
                        "claim_id",
                        "worker_id",
                        "generation",
                        "issue_number",
                        "role",
                        "context_id",
                        "head_sha",
                    ]
                },
                "profile_digest": cfg["profile_digest"],
                "status": "reserved",
                "container_id": None,
                "started_at": q["now"],
                "updated_at": q["now"],
                "stopped": False,
                "artifact_digest": None,
            }
            db.execute(
                "INSERT INTO attempts VALUES(?,?,?,?,?,?,?)",
                (
                    a["attempt_id"],
                    a["run_id"],
                    a["claim_id"],
                    a["role"],
                    1,
                    encoded(a),
                    fingerprint,
                ),
            )
            event("reserve", q)
            return {**a, "epoch": epoch}
        if cmd == "observe":
            exact(
                q,
                [
                    "attempt_id",
                    "epoch",
                    "status",
                    "container_id",
                    "stopped",
                    "artifact_digest",
                    "now",
                ],
            )
            a = attempt(q)
            instant(q["now"])
            require(
                q["status"]
                in {"starting", "running", "completed", "failed", "stopped", "unknown"}
                and isinstance(q["stopped"], bool)
                and (
                    q["container_id"] is None
                    or re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", q["container_id"])
                )
                and (
                    q["artifact_digest"] is None or HEX.fullmatch(q["artifact_digest"])
                )
            )
            require(
                q["status"] not in {"completed", "failed", "stopped"} or q["stopped"],
                "stop_confirmation_required",
            )
            require(
                q["status"] != "completed" or q["artifact_digest"] is not None,
                "artifact_required",
            )
            require(
                a["container_id"] is None or a["container_id"] == q["container_id"],
                "container_changed",
            )
            if q["status"] in {"starting", "running"}:
                require_running(run(a["run_id"]), q["now"])
            a.update(
                {
                    k: q[k]
                    for k in ["status", "container_id", "stopped", "artifact_digest"]
                }
            )
            a["updated_at"] = q["now"]
            db.execute(
                "UPDATE attempts SET active=?,data=? WHERE id=?",
                (not a["stopped"], encoded(a), a["attempt_id"]),
            )
            event("observe", q)
            return a
        if cmd == "reserve_usage":
            exact(q, ["request_id", "attempt_id", "epoch", "input_digest", "now"])
            identifier(q["request_id"])
            require(HEX.fullmatch(q["input_digest"]))
            a = attempt(q)
            r = run(a["run_id"])
            require_running(r, q["now"])
            require(a["role"] != "verification", "model_forbidden")
            fingerprint = digest(
                {k: v for k, v in q.items() if k not in {"now", "epoch"}}
            )
            old = db.execute(
                "SELECT data,request_digest FROM usage WHERE id=?", (q["request_id"],)
            ).fetchone()
            if old:
                require(old[1] == fingerprint, "usage_replayed")
                raise Rejected("usage_already_reserved")
            require(
                not db.execute(
                    "SELECT 1 FROM usage WHERE status IN ('reserved','unknown')"
                ).fetchone(),
                "usage_unknown",
            )
            worst = (
                model["context_tokens"] * model["input_microusd_per_million"]
                + lim["max_output_tokens"] * model["output_microusd_per_million"]
                + 999999
            ) // 1000000
            require(
                worst > 0
                and r["spent"] + worst <= lim["cost_microusd"]
                and r["requests"] < lim["max_requests"]
                and count("usage") < 100000,
                "budget_exhausted",
            )
            r["spent"] += worst
            r["requests"] += 1
            save_run(r)
            u = {
                "schema_version": 1,
                "artifact_kind": "runner-usage",
                "request_id": q["request_id"],
                "attempt_id": a["attempt_id"],
                "run_id": a["run_id"],
                "profile_digest": cfg["profile_digest"],
                "status": "reserved",
                "reserved_microusd": worst,
                "actual_microusd": None,
                "input_tokens": None,
                "output_tokens": None,
                "response_digest": None,
            }
            db.execute(
                "INSERT INTO usage VALUES(?,?,?,?,?)",
                (u["request_id"], a["attempt_id"], "reserved", encoded(u), fingerprint),
            )
            event("usage_reserved", q)
            return u
        if cmd == "settle_usage":
            exact(
                q,
                [
                    "request_id",
                    "attempt_id",
                    "epoch",
                    "input_tokens",
                    "output_tokens",
                    "response_digest",
                    "now",
                ],
            )
            a = attempt(q)
            instant(q["now"])
            row = db.execute(
                "SELECT data FROM usage WHERE id=?", (q["request_id"],)
            ).fetchone()
            require(row is not None, "usage_missing")
            u = load(row[0])
            require(
                u["attempt_id"] == a["attempt_id"]
                and u["status"] == "reserved"
                and HEX.fullmatch(q["response_digest"]),
                "usage_conflict",
            )
            for k, cap in [
                ("input_tokens", model["context_tokens"]),
                ("output_tokens", lim["max_output_tokens"]),
            ]:
                require(
                    isinstance(q[k], int)
                    and not isinstance(q[k], bool)
                    and 0 <= q[k] <= cap,
                    "usage_invalid",
                )
            actual = (
                q["input_tokens"] * model["input_microusd_per_million"]
                + q["output_tokens"] * model["output_microusd_per_million"]
                + 999999
            ) // 1000000
            require(actual <= u["reserved_microusd"], "usage_invalid")
            r = run(a["run_id"])
            r["spent"] -= u["reserved_microusd"] - actual
            save_run(r)
            u.update(
                status="confirmed",
                actual_microusd=actual,
                input_tokens=q["input_tokens"],
                output_tokens=q["output_tokens"],
                response_digest=q["response_digest"],
            )
            db.execute(
                "UPDATE usage SET status='confirmed',data=? WHERE id=?",
                (encoded(u), u["request_id"]),
            )
            event("usage_settled", q)
            return u
        if cmd == "recover":
            exact(q, ["attempts", "now"])
            instant(q["now"])
            old = [a for a in rows("attempts") if not a["stopped"]]
            require(
                len(old) == len(q["attempts"])
                and {a["attempt_id"] for a in old}
                == {a["attempt_id"] for a in q["attempts"]},
                "recovery_incomplete",
            )
            for choice in q["attempts"]:
                exact(choice, ["attempt_id", "artifact_digest"])
                require(HEX.fullmatch(choice["artifact_digest"]))
                a = next(a for a in old if a["attempt_id"] == choice["attempt_id"])
                a.update(
                    status="stopped",
                    stopped=True,
                    artifact_digest=choice["artifact_digest"],
                    updated_at=q["now"],
                )
                db.execute(
                    "UPDATE attempts SET active=0,data=? WHERE id=?",
                    (encoded(a), a["attempt_id"]),
                )
            require(
                not db.execute(
                    "SELECT 1 FROM usage WHERE status IN ('reserved','unknown')"
                ).fetchone(),
                "usage_unknown",
            )
            put_meta("recovery", False)
            event("recover", q)
            return {"recovered": True}
        raise Rejected("command_invalid")

    def emit(q):
        raw = encoded(q).encode()
        require(len(raw) <= MAX, "output_limit")
        sys.stdout.buffer.write(raw + b"\n")
        sys.stdout.buffer.flush()

    emit({"id": 0, "ok": True, "value": {"epoch": epoch}})
    while True:
        raw = sys.stdin.buffer.readline(MAX + 1)
        if not raw:
            break
        req_id = None
        try:
            require(len(raw) <= MAX and raw.endswith(b"\n"), "frame_limit")
            q = load(raw)
            exact(q, ["id", "command", "data"])
            req_id = q["id"]
            require(
                isinstance(req_id, int) and not isinstance(req_id, bool) and req_id > 0
            )
            deadline = time.monotonic() + 5
            db.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
            db.execute("BEGIN IMMEDIATE")
            value = rpc(q["command"], q["data"])
            require(len(encoded(value).encode()) <= MAX - 128, "output_limit")
            db.commit()
            emit({"id": req_id, "ok": True, "value": value})
            if q["command"] == "close":
                break
        except Exception as e:
            if db.in_transaction:
                db.rollback()
            emit(
                {
                    "id": req_id,
                    "ok": False,
                    "error": (
                        str(e) if isinstance(e, Rejected) else "ledger_unavailable"
                    ),
                }
            )
            if isinstance(e, Rejected) and str(e) == "frame_limit":
                break
    db.close()
    os.close(fd)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(
            encoded(
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
