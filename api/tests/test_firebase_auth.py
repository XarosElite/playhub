"""
Firebase ID token verification with real cryptography.

These tests mint RS256-signed ID tokens shaped exactly like Firebase's, serve
the signing certificate the way Google's cert endpoint does, and run them
through the real google-auth verification used in production. Only the HTTP
fetch of Google's certificates is replaced.
"""
import datetime
import json
import time

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from google.auth import crypt, jwt

import app.internal.auth as auth
from app.internal.auth import AuthError, verify_token

PROJECT_ID = "playhub-test"
CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"


def _key_and_cert(common_name="securetoken.system.gserviceaccount.com"):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject).issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    private_pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption(),
    ).decode()
    return private_pem, cert.public_bytes(serialization.Encoding.PEM).decode()


class FakeCertsResponse:
    def __init__(self, status, body):
        self.status = status
        self.data = json.dumps(body).encode()
        self.headers = {}


class GoogleCerts:
    """Stands in for google.auth.transport.requests.Request when fetching Google's signing certs."""

    def __init__(self):
        self.certs: dict[str, str] = {}
        self.status = 200
        self.urls: list[str] = []

    def __call__(self, url, method="GET", **kwargs):
        self.urls.append(url)
        return FakeCertsResponse(self.status, self.certs)


@pytest.fixture(scope="module")
def signing_key():
    return _key_and_cert()


@pytest.fixture(scope="module")
def rogue_key():
    return _key_and_cert()


@pytest.fixture
def google(monkeypatch, signing_key):
    certs = GoogleCerts()
    certs.certs = {"key-1": signing_key[1]}
    monkeypatch.setattr(auth, "_google_request", certs)
    return certs


def mint(private_pem, kid="key-1", **overrides):
    """A Firebase ID token. Claims can be overridden or removed (value None)."""
    now = int(time.time())
    claims = {
        "iss": f"https://securetoken.google.com/{PROJECT_ID}",
        "aud": PROJECT_ID,
        "auth_time": now - 10,
        "user_id": "uid-alice",
        "sub": "uid-alice",
        "iat": now - 10,
        "exp": now + 3600,
        "email": "alice@example.com",
        "email_verified": True,
        "name": "Alice",
        "picture": "https://example.com/alice.png",
        "firebase": {"identities": {"google.com": ["123"]}, "sign_in_provider": "google.com"},
    }
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    signer = crypt.RSASigner.from_string(private_pem, key_id=kid)
    return jwt.encode(signer, claims).decode()


def assert_rejected(token, status=401):
    with pytest.raises(AuthError) as error:
        verify_token(token)
    assert error.value.status_code == status
    return error.value


class TestValidTokens:
    def test_valid_token_returns_the_user(self, google, signing_key):
        token = mint(signing_key[0])
        user = verify_token(token)
        assert user.uid == "uid-alice"
        assert user.email == "alice@example.com"
        assert user.name == "Alice"
        assert user.picture == "https://example.com/alice.png"
        assert user.expires_at == pytest.approx(time.time() + 3600, abs=5)
        assert google.urls == [CERTS_URL]

    def test_token_without_optional_profile_claims(self, google, signing_key):
        user = verify_token(mint(signing_key[0], email=None, name=None, picture=None, email_verified=None))
        assert (user.uid, user.email, user.name, user.picture) == ("uid-alice", None, None, None)

    def test_key_rotation_picks_the_matching_kid(self, google, signing_key, rogue_key):
        google.certs = {"old-key": rogue_key[1], "key-1": signing_key[1]}
        assert verify_token(mint(signing_key[0], kid="key-1")).uid == "uid-alice"

    def test_small_clock_skew_is_tolerated(self, google, signing_key):
        # Issued "in the future" by less than CLOCK_SKEW_SECONDS.
        now = int(time.time())
        token = mint(signing_key[0], iat=now + auth.CLOCK_SKEW_SECONDS - 3)
        assert verify_token(token).uid == "uid-alice"


class TestCaching:
    def test_verified_tokens_are_cached_until_they_expire(self, google, signing_key):
        token = mint(signing_key[0])
        first = verify_token(token)
        second = verify_token(token)
        assert first is second
        assert len(google.urls) == 1  # certs fetched once

    def test_cache_is_keyed_by_a_hash_not_the_token(self, google, signing_key):
        token = mint(signing_key[0])
        verify_token(token)
        assert token not in auth._token_cache
        assert auth._cache_key(token) in auth._token_cache

    def test_expired_cache_entries_are_reverified(self, google, signing_key, monkeypatch):
        token = mint(signing_key[0])
        verify_token(token)
        key = auth._cache_key(token)
        expires_at, user = auth._token_cache[key]
        auth._token_cache[key] = (time.time() - 1, user)
        verify_token(token)
        assert len(google.urls) == 2

    def test_rejected_tokens_are_not_cached(self, google, rogue_key):
        token = mint(rogue_key[0])
        assert_rejected(token)
        assert_rejected(token)
        assert len(google.urls) == 2
        assert auth._token_cache == {}

    def test_cache_evicts_expired_entries_when_full(self, monkeypatch):
        monkeypatch.setattr(auth, "_CACHE_MAX_ENTRIES", 3)
        user = auth.AuthUser("u", None, None, None)
        auth._cache_put("expired", time.time() - 1, user)
        auth._cache_put("a", time.time() + 100, user)
        auth._cache_put("b", time.time() + 100, user)
        auth._cache_put("c", time.time() + 100, user)
        assert set(auth._token_cache) == {"a", "b", "c"}

    def test_cache_is_cleared_when_full_of_live_entries(self, monkeypatch):
        monkeypatch.setattr(auth, "_CACHE_MAX_ENTRIES", 2)
        user = auth.AuthUser("u", None, None, None)
        auth._cache_put("a", time.time() + 100, user)
        auth._cache_put("b", time.time() + 100, user)
        auth._cache_put("c", time.time() + 100, user)
        assert set(auth._token_cache) == {"c"}

    def test_cache_get_drops_expired_entries(self):
        auth._cache_put("old", time.time() - 1, auth.AuthUser("u", None, None, None))
        assert auth._cache_get("old") is None
        assert "old" not in auth._token_cache


class TestRejectedTokens:
    def test_signed_by_someone_else(self, google, rogue_key):
        error = assert_rejected(mint(rogue_key[0]))
        assert error.detail == "Invalid or expired session"

    def test_unknown_key_id(self, google, rogue_key):
        assert_rejected(mint(rogue_key[0], kid="not-a-google-key"))

    def test_expired(self, google, signing_key):
        now = int(time.time())
        assert_rejected(mint(signing_key[0], iat=now - 7200, exp=now - 3600))

    def test_expired_beyond_clock_skew(self, google, signing_key):
        now = int(time.time())
        assert_rejected(mint(signing_key[0], iat=now - 3600, exp=now - auth.CLOCK_SKEW_SECONDS - 5))

    def test_issued_in_the_future(self, google, signing_key):
        now = int(time.time())
        assert_rejected(mint(signing_key[0], iat=now + 600, exp=now + 4200))

    def test_for_another_firebase_project(self, google, signing_key):
        assert_rejected(mint(signing_key[0], aud="someone-elses-project"))

    def test_wrong_issuer(self, google, signing_key):
        # Right audience, but not issued by Firebase for this project.
        assert_rejected(mint(signing_key[0], iss="https://accounts.google.com"))

    def test_issuer_for_another_project(self, google, signing_key):
        assert_rejected(mint(signing_key[0], iss="https://securetoken.google.com/other-project"))

    def test_missing_subject(self, google, signing_key):
        assert_rejected(mint(signing_key[0], sub=None))

    def test_empty_subject(self, google, signing_key):
        assert_rejected(mint(signing_key[0], sub=""))

    def test_tampered_payload(self, google, signing_key):
        header, payload, signature = mint(signing_key[0]).split(".")
        claims = json.loads(jwt._helpers.padded_urlsafe_b64decode(payload))
        claims["sub"] = "uid-admin"
        forged = jwt._helpers.unpadded_urlsafe_b64encode(json.dumps(claims).encode()).decode()
        assert_rejected(f"{header}.{forged}.{signature}")

    def test_unsigned_token(self, google):
        # alg "none" (as issued by the Firebase emulator) must never be accepted.
        header = jwt._helpers.unpadded_urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').decode()
        now = int(time.time())
        body = jwt._helpers.unpadded_urlsafe_b64encode(json.dumps({
            "iss": f"https://securetoken.google.com/{PROJECT_ID}", "aud": PROJECT_ID,
            "sub": "uid-alice", "iat": now, "exp": now + 3600,
        }).encode()).decode()
        assert_rejected(f"{header}.{body}.")

    @pytest.mark.parametrize("token", ["", "garbage", "a.b.c", "Bearer x"])
    def test_garbage(self, google, token):
        assert_rejected(token)

    def test_google_cert_endpoint_down(self, google, signing_key):
        google.status = 503
        assert_rejected(mint(signing_key[0]))


class TestConfiguration:
    def test_no_project_configured(self, monkeypatch, google, signing_key):
        monkeypatch.setattr(auth, "FIREBASE_PROJECT_ID", "")
        error = assert_rejected(mint(signing_key[0]), status=503)
        assert error.detail == "Authentication is not configured on the server"
        assert google.urls == []

    def test_allowlist_admits_listed_verified_emails(self, monkeypatch, google, signing_key):
        monkeypatch.setattr(auth, "ALLOWED_EMAILS", {"alice@example.com"})
        assert verify_token(mint(signing_key[0], email="Alice@Example.com")).uid == "uid-alice"

    def test_allowlist_rejects_other_emails(self, monkeypatch, google, signing_key):
        monkeypatch.setattr(auth, "ALLOWED_EMAILS", {"bob@example.com"})
        error = assert_rejected(mint(signing_key[0]), status=403)
        assert error.detail == "This account is not allowed to access PlayHub"

    def test_allowlist_rejects_unverified_emails(self, monkeypatch, google, signing_key):
        monkeypatch.setattr(auth, "ALLOWED_EMAILS", {"alice@example.com"})
        assert_rejected(mint(signing_key[0], email_verified=False), status=403)

    def test_allowlist_rejects_accounts_without_email(self, monkeypatch, google, signing_key):
        monkeypatch.setattr(auth, "ALLOWED_EMAILS", {"alice@example.com"})
        assert_rejected(mint(signing_key[0], email=None), status=403)

    def test_allowlisted_rejection_is_not_cached(self, monkeypatch, google, signing_key):
        monkeypatch.setattr(auth, "ALLOWED_EMAILS", {"bob@example.com"})
        token = mint(signing_key[0])
        assert_rejected(token, status=403)
        monkeypatch.setattr(auth, "ALLOWED_EMAILS", {"alice@example.com"})
        assert verify_token(token).uid == "uid-alice"


class TestEnvironmentParsing:
    """
    FIREBASE_PROJECT_ID / AUTH_ALLOWED_EMAILS are read when the module is
    imported, so each case imports it in a fresh interpreter.
    """

    def _load(self, **env):
        import os
        import subprocess
        import sys
        from pathlib import Path
        clean = {k: v for k, v in os.environ.items()
                 if k not in ("FIREBASE_PROJECT_ID", "VITE_FIREBASE_PROJECT_ID", "AUTH_ALLOWED_EMAILS")}
        out = subprocess.run(
            [sys.executable, "-c",
             "import json, app.internal.auth as a; print(json.dumps([a.FIREBASE_PROJECT_ID, sorted(a.ALLOWED_EMAILS)]))"],
            env={**clean, **env}, cwd=Path(__file__).resolve().parent.parent,
            capture_output=True, text=True, check=True,
        )
        project, emails = json.loads(out.stdout.strip().splitlines()[-1])
        return project, set(emails)

    def test_project_id_from_backend_variable(self):
        assert self._load(FIREBASE_PROJECT_ID=" my-project ")[0] == "my-project"

    def test_project_id_falls_back_to_frontend_variable(self):
        assert self._load(VITE_FIREBASE_PROJECT_ID="web-project")[0] == "web-project"

    def test_backend_variable_wins(self):
        assert self._load(FIREBASE_PROJECT_ID="api", VITE_FIREBASE_PROJECT_ID="web")[0] == "api"

    def test_unset(self):
        assert self._load() == ("", set())

    def test_allowlist_is_trimmed_lowercased_and_skips_blanks(self):
        _, emails = self._load(AUTH_ALLOWED_EMAILS=" Alice@Example.com, ,bob@example.com,")
        assert emails == {"alice@example.com", "bob@example.com"}


class TestLogAuthConfig:
    def test_missing_project_is_an_error(self, monkeypatch, caplog):
        monkeypatch.setattr(auth, "FIREBASE_PROJECT_ID", "")
        with caplog.at_level("INFO"):
            auth.log_auth_config()
        assert "FIREBASE_PROJECT_ID is not set" in caplog.text
        assert any(r.levelname == "ERROR" for r in caplog.records)

    def test_open_signups_are_warned_about(self, caplog):
        with caplog.at_level("INFO"):
            auth.log_auth_config()
        assert "Verifying Firebase sign-ins for project 'playhub-test'" in caplog.text
        assert "AUTH_ALLOWED_EMAILS is not set" in caplog.text

    def test_allowlist_configured(self, monkeypatch, caplog):
        monkeypatch.setattr(auth, "ALLOWED_EMAILS", {"a@example.com"})
        with caplog.at_level("INFO"):
            auth.log_auth_config()
        assert "AUTH_ALLOWED_EMAILS is not set" not in caplog.text
