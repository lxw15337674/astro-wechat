"""WeChat forwarding proxy.

Implements docs/proxy-contract.md. Copy this module into the service running on
the fixed-IP host and mount the router.

The proxy does not understand WeChat. It does not parse response bodies, does
not know what `errcode` means, and holds no WeChat credentials. All protocol
knowledge lives in the Node client (ADR-0005), which is why there is exactly one
place where error classification has to be right.
"""

from __future__ import annotations

import hmac
import logging
import os

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/wechat", tags=["wechat"])

# Fixed, never read from the request. A proxy that forwards to a caller-supplied
# host is an open proxy: it can be used to attack third parties from this IP, or
# to reach services on this machine's private network.
WECHAT_ORIGIN = "https://api.weixin.qq.com"

# Because WeChat enforces an IP allowlist, reaching this proxy *is* the
# capability to operate the account. The allowlist therefore bounds the blast
# radius of a leaked token: there is no mass-send endpoint here.
ALLOWED_PATHS = frozenset(
    {
        "/cgi-bin/stable_token",
        "/cgi-bin/media/uploadimg",
        "/cgi-bin/material/add_material",
        "/cgi-bin/draft/add",
        "/cgi-bin/draft/batchget",
    }
)

# Irreversible, and only needed during infrequent manual maintenance. Enable it
# for the cleanup run, then turn it off again.
DELETE_MATERIAL_PATH = "/cgi-bin/material/del_material"

MAX_BODY_BYTES = 12 * 1024 * 1024
TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=60.0, pool=10.0)

_FORWARDED_REQUEST_HEADERS = {"content-type"}
_FORWARDED_RESPONSE_HEADERS = {"content-type"}


def _expected_token() -> str:
    token = os.environ.get("WECHAT_PROXY_TOKEN", "")
    if not token:
        raise HTTPException(status_code=503, detail="proxy token not configured")
    return token


def _authorize(request: Request) -> None:
    header = request.headers.get("authorization", "")
    prefix = "Bearer "
    presented = header[len(prefix) :] if header.startswith(prefix) else ""

    # Constant-time: a naive comparison leaks the token one character at a time
    # to anyone who can measure response latency.
    if not hmac.compare_digest(presented, _expected_token()):
        raise HTTPException(status_code=401, detail="invalid proxy token")


def _allowed(path: str) -> bool:
    if path in ALLOWED_PATHS:
        return True
    if path == DELETE_MATERIAL_PATH:
        return os.environ.get("WECHAT_PROXY_ALLOW_DELETE", "").lower() in {"1", "true", "yes"}
    return False


@router.api_route("/{upstream_path:path}", methods=["GET", "POST"])
async def forward(upstream_path: str, request: Request) -> Response:
    _authorize(request)

    path = "/" + upstream_path.lstrip("/")
    if not _allowed(path):
        raise HTTPException(status_code=403, detail="path not allowed")

    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="request body too large")

    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() in _FORWARDED_REQUEST_HEADERS
    }

    # Never log request.url.query or body: the access token travels in the query
    # string and the AppSecret is in the token request body. One ordinary access
    # log line is enough to put both on disk.
    logger.info("forwarding %s %s", request.method, path)

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False) as client:
            upstream = await client.request(
                request.method,
                f"{WECHAT_ORIGIN}{path}",
                params=dict(request.query_params),
                content=body,
                headers=headers,
            )
    except httpx.TimeoutException:
        # Empty body on purpose: the caller must read this as "outcome unknown"
        # and reconcile rather than retry a write.
        logger.warning("upstream timeout for %s", path)
        return Response(status_code=504)
    except httpx.HTTPError:
        logger.warning("upstream connection error for %s", path)
        return Response(status_code=502)

    response_headers = {
        key: value
        for key, value in upstream.headers.items()
        if key.lower() in _FORWARDED_RESPONSE_HEADERS
    }

    # Returned verbatim. The client's error handling depends on seeing the real
    # response, including an `errcode` inside an HTTP 200.
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=response_headers,
    )
