"""Fixed provider request. Credential in a pipe, never argv, logs or worker."""

import json, ssl, sys, urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


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
        urllib.request.HTTPSHandler(context=ssl.create_default_context()), NoRedirect()
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
