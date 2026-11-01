"""
Firebase Authentication for the API.

User accounts live in Firebase. The frontend signs in with the Firebase JS SDK
and sends the resulting ID token as ``Authorization: Bearer <token>``. We verify
the token's signature against Google's public keys, so no service-account
credentials are needed – only the Firebase project ID.

Environment:
    FIREBASE_PROJECT_ID    Firebase project ID (required; falls back to the
                           frontend's VITE_FIREBASE_PROJECT_ID)
    AUTH_ALLOWED_EMAILS    Optional comma-separated allowlist. When set, only
                           these (verified) email addresses may use the API.
"""
import asyncio
import hashlib
import logging
import os
import threading
import time
from dataclasses import dataclass
from typing import Annotated, Optional

import google.auth.transport.requests
from fastapi import Depends, HTTPException, WebSocket, status
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.oauth2 import id_token

from app.internal.users import record_user

FIREBASE_PROJECT_ID = (
    os.environ.get("FIREBASE_PROJECT_ID") or os.environ.get("VITE_FIREBASE_PROJECT_ID") or ""
).strip()
ALLOWED_EMAILS = {
    email.strip().lower()
    for email in os.environ.get("AUTH_ALLOWED_EMAILS", "").split(",")
    if email.strip()
}

# Tolerate small clock differences between this host and Google.
CLOCK_SKEW_SECONDS = 10
# How long a websocket client has to send its token after connecting.
WEBSOCKET_AUTH_TIMEOUT_SECONDS = 10
# Close code sent when websocket authentication fails (4000-4999 are app-defined).
WEBSOCKET_UNAUTHORIZED = 4401

_CACHE_MAX_ENTRIES = 1000


@dataclass(frozen=True)
class AuthUser:
    uid: str
    email: Optional[str]
    name: Optional[str]
    picture: Optional[str]
    expires_at: float = 0.0  # when the ID token expires (epoch seconds)


class AuthError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


# google-auth fetches Google's signing certificates on every verification, so
# verified tokens are cached until they expire (Firebase tokens last 1 hour).
_google_request = google.auth.transport.requests.Request()
_token_cache: dict[str, tuple[float, AuthUser]] = {}
_cache_lock = threading.Lock()


def log_auth_config():
    if not FIREBASE_PROJECT_ID:
        logging.error("FIREBASE_PROJECT_ID is not set – every authenticated request will be rejected.")
    else:
        logging.info(f"Verifying Firebase sign-ins for project '{FIREBASE_PROJECT_ID}'.")
    if not ALLOWED_EMAILS:
        logging.warning(
            "AUTH_ALLOWED_EMAILS is not set – any Google account can sign in and create servers on this host."
        )


def _cache_key(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _cache_get(key: str) -> Optional[AuthUser]:
    with _cache_lock:
        entry = _token_cache.get(key)
        if entry is None:
            return None
        expires_at, user = entry
        if expires_at <= time.time():
            del _token_cache[key]
            return None
        return user


def _cache_put(key: str, expires_at: float, user: AuthUser):
    with _cache_lock:
        if len(_token_cache) >= _CACHE_MAX_ENTRIES:
            now = time.time()
            for k in [k for k, (exp, _) in _token_cache.items() if exp <= now]:
                del _token_cache[k]
            if len(_token_cache) >= _CACHE_MAX_ENTRIES:
                _token_cache.clear()
        _token_cache[key] = (expires_at, user)


def verify_token(token: str) -> AuthUser:
    """Verify a Firebase ID token and return the user. Blocking (may fetch certs)."""
    if not FIREBASE_PROJECT_ID:
        raise AuthError(status.HTTP_503_SERVICE_UNAVAILABLE, "Authentication is not configured on the server")

    key = _cache_key(token)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    try:
        claims = id_token.verify_firebase_token(
            token, _google_request, audience=FIREBASE_PROJECT_ID,
            clock_skew_in_seconds=CLOCK_SKEW_SECONDS,
        )
    except Exception as e:
        logging.info(f"Rejected Firebase token: {e}")
        raise AuthError(status.HTTP_401_UNAUTHORIZED, "Invalid or expired session") from None

    # verify_firebase_token checks signature, expiry and audience; also check the issuer and subject.
    if claims.get("iss") != f"https://securetoken.google.com/{FIREBASE_PROJECT_ID}" or not claims.get("sub"):
        raise AuthError(status.HTTP_401_UNAUTHORIZED, "Invalid or expired session")

    email = claims.get("email")
    if ALLOWED_EMAILS and not (
        email and claims.get("email_verified") and email.lower() in ALLOWED_EMAILS
    ):
        raise AuthError(status.HTTP_403_FORBIDDEN, "This account is not allowed to access PlayHub")

    user = AuthUser(
        uid=claims["sub"],
        email=email,
        name=claims.get("name"),
        picture=claims.get("picture"),
        expires_at=float(claims["exp"]),
    )
    _cache_put(key, float(claims["exp"]), user)
    return user


_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(_bearer)],
) -> AuthUser:
    """FastAPI dependency: the signed-in user, or 401."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not signed in",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        user = await run_in_threadpool(verify_token, credentials.credentials)
    except AuthError as e:
        headers = {"WWW-Authenticate": "Bearer"} if e.status_code == status.HTTP_401_UNAUTHORIZED else None
        raise HTTPException(status_code=e.status_code, detail=e.detail, headers=headers) from None
    # Keep the user directory (used for sharing) up to date. Throttled internally.
    await run_in_threadpool(record_user, user)
    return user


CurrentUser = Annotated[AuthUser, Depends(get_current_user)]


async def authenticate_websocket(websocket: WebSocket) -> Optional[AuthUser]:
    """
    Authenticate an accepted websocket. Browsers can't set headers on websocket
    requests and query-string tokens end up in access logs, so the client must
    send its ID token as the first message. Closes the socket and returns None
    on failure.
    """
    try:
        token = await asyncio.wait_for(websocket.receive_text(), timeout=WEBSOCKET_AUTH_TIMEOUT_SECONDS)
        return await run_in_threadpool(verify_token, token.strip())
    except Exception as e:  # timeout, disconnect, or AuthError
        reason = e.detail if isinstance(e, AuthError) else "Authentication required"
        try:
            await websocket.send_text(f"\r\n\033[31m{reason}\033[0m\r\n")
            await websocket.close(code=WEBSOCKET_UNAUTHORIZED, reason=reason)
        except Exception:
            pass
        return None
