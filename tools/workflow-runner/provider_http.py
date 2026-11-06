"""Fixed provider request. Credential in a pipe, never argv, logs or worker."""

import ctypes, json, os, signal, ssl, sys, urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def bind_parent():
    """A killed supervisor must not leave its credential-bearing helper running."""
    parent = os.getppid()
    if sys.platform != "linux" or parent == 1:
        raise ValueError()
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [
        ctypes.c_int,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_ulong,
        ctypes.c_ulong,
    ]
    libc.prctl.restype = ctypes.c_int
    if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0 or os.getppid() != parent:
        raise ValueError()


def main():
    try:
        data = sys.stdin.buffer.read(6 * 1024 * 1024 + 1)
        if len(data) > 6 * 1024 * 1024:
            raise ValueError()
        q = json.loads(data)
        body = json.dumps(q["body"], separators=(",", ":")).encode()
        request = urllib.request.Request(
            "https://api.openai.com/v1/responses",
            data=body,
            headers={
                "Authorization": "Bearer " + q["credential"],
                "Content-Type": "application/json",
            },
            method="POST",
        )
        opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=ssl.create_default_context()),
            NoRedirect(),
        )
        with opener.open(request, timeout=q["timeout_seconds"]) as response:
            result = response.read(16 * 1024 * 1024 + 1)
            if len(result) > 16 * 1024 * 1024:
                raise ValueError()
            print(
                json.dumps(
                    {
                        "status": response.status,
                        "content_type": response.headers.get("Content-Type", ""),
                        "body": result.decode("utf8"),
                    }
                )
            )
    except Exception:
        sys.exit(1)


if __name__ == "__main__":
    bind_parent()
    main()
