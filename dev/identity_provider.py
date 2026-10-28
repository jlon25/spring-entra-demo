#!/usr/bin/env python3
"""Development-only RS256 issuer. Requires Python 3.10+ and OpenSSL 3.x.

Run: python3 dev/identity_provider.py
The default binding is loopback. Container binding requires explicit configuration.
This issuer is only for development and must never serve production authentication.
"""

import base64
import hmac
import ipaddress
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit


def configuration(environ=None):
    """Read explicit container overrides while keeping standalone loopback defaults."""
    values = os.environ if environ is None else environ
    host = values.get("DEV_IDENTITY_BIND_ADDRESS", "127.0.0.1")
    issuer = values.get("DEV_IDENTITY_ISSUER", "http://localhost:9000")
    try:
        ipaddress.IPv4Address(host)
        parsed = urlsplit(issuer)
        # Accessing port also rejects malformed or out-of-range port values.
        parsed.port
        valid_issuer = (
            parsed.scheme in ("http", "https") and parsed.hostname
            and parsed.username is None and parsed.password is None
            and not parsed.query and not parsed.fragment
            and not any(character.isspace() for character in issuer)
            and "?" not in issuer and "#" not in issuer
        )
    except (ValueError, TypeError):
        raise ValueError("Invalid development identity bind address or issuer") from None
    if not valid_issuer:
        raise ValueError("Development issuer must be an absolute HTTP(S) URL without credentials, query or fragment")
    return host, issuer



def credentials_configuration(environ=None):
    """One explicitly configured development account; never a production user store."""
    values = os.environ if environ is None else environ
    username = values.get("DEV_IDENTITY_USERNAME", "local-user")
    password = values.get("DEV_IDENTITY_PASSWORD")
    if (not isinstance(username, str) or not username.strip() or len(username) > 128
            or any(ord(character) < 32 for character in username)
            or not isinstance(password, str) or len(password) < 12 or len(password) > 1024):
        raise ValueError("Configure a development username and password of at least 12 characters")
    try:
        username.encode("utf-8")
        password.encode("utf-8")
    except UnicodeError:
        raise ValueError("Development credentials must be valid UTF-8") from None
    return username, password


def credentials_match(supplied, expected):
    # Evaluate both comparisons, including when the username is incorrect.
    username_matches = hmac.compare_digest(supplied[0].encode("utf-8"), expected[0].encode("utf-8"))
    password_matches = hmac.compare_digest(supplied[1].encode("utf-8"), expected[1].encode("utf-8"))
    return username_matches & password_matches


def base64url(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def openssl(*arguments, data=None):
    return subprocess.run(
        ["openssl", *arguments], input=data, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, check=True,
    ).stdout


class DevelopmentIdentity:
    """One ephemeral key, discarded when the process stops."""

    def __init__(self, directory, issuer="http://localhost:9000"):
        self.issuer = issuer
        self.private_key = Path(directory) / "development-only.pem"
        openssl("genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048",
                "-pkeyopt", "rsa_keygen_pubexp:65537", "-out", str(self.private_key))
        os.chmod(self.private_key, 0o600)
        modulus = openssl("rsa", "-in", str(self.private_key), "-noout", "-modulus")
        modulus_bytes = bytes.fromhex(modulus.decode("ascii").strip().split("=", 1)[1])
        self.jwk = {
            "kty": "RSA", "use": "sig", "alg": "RS256", "kid": "local-development",
            "n": base64url(modulus_bytes.lstrip(b"\x00")),
            "e": base64url((65537).to_bytes(3, "big")),
        }

    def token_response(self, subject="local-user"):
        now = int(time.time())
        header = {"alg": "RS256", "typ": "JWT", "kid": self.jwk["kid"]}
        claims = {
            "iss": self.issuer, "aud": "spring-entra-demo", "sub": subject,
            "iat": now, "nbf": now, "exp": now + 300, "scope": "api.read",
        }
        signing_input = ".".join(
            base64url(json.dumps(value, separators=(",", ":")).encode("utf-8"))
            for value in (header, claims)
        ).encode("ascii")
        signature = openssl("dgst", "-sha256", "-sign", str(self.private_key),
                            data=signing_input)
        return {
            "access_token": signing_input.decode("ascii") + "." + base64url(signature),
            "token_type": "Bearer", "expires_in": 300, "scope": "api.read",
        }


def make_server(identity, port=9000, host="127.0.0.1", *, credentials):
    if not isinstance(credentials, tuple) or len(credentials) != 2:
        raise ValueError("Explicit development credentials are required")
    username, password = credentials_configuration({
        "DEV_IDENTITY_USERNAME": credentials[0], "DEV_IDENTITY_PASSWORD": credentials[1],
    })

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def do_GET(self):
            if self.path == "/jwks":
                self.respond(200, {"keys": [identity.jwk]})
            elif self.path == "/token":
                self.respond(405, {"error": "method_not_allowed"}, allow="POST")
            else:
                self.respond(404, {"error": "not_found"})

        def do_POST(self):
            if self.path != "/token":
                self.respond(404, {"error": "not_found"})
                return
            if self.headers.get("Transfer-Encoding"):
                self.respond(400, {"error": "invalid_request"})
                return
            lengths = self.headers.get_all("Content-Length", [])
            if not lengths:
                self.respond(411, {"error": "length_required"})
                return
            if len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit():
                self.respond(400, {"error": "invalid_request"})
                return
            if len(lengths[0]) > 10:
                self.respond(413, {"error": "request_too_large"})
                return
            length = int(lengths[0])
            if length > 4096:
                self.respond(413, {"error": "request_too_large"})
                return
            if not self.headers.get("Content-Type") or self.headers.get_content_type() != "application/json":
                self.respond(415, {"error": "unsupported_media_type"})
                return
            try:
                body = self.rfile.read(length)
                if len(body) != length:
                    raise ValueError("Incomplete request")
                payload = json.loads(body.decode("utf-8"))
                if (not isinstance(payload, dict) or set(payload) != {"username", "password"}
                        or not all(isinstance(payload[key], str) and payload[key]
                                   for key in ("username", "password"))):
                    raise ValueError("Invalid credentials payload")
                supplied = payload["username"], payload["password"]
                # Reject malformed Unicode instead of leaking it through an exception log.
                supplied[0].encode("utf-8")
                supplied[1].encode("utf-8")
            except (ValueError, UnicodeError, RecursionError):
                self.respond(400, {"error": "invalid_request"})
                return
            except OSError:
                self.respond(408, {"error": "request_timeout"})
                return
            if not credentials_match(supplied, (username, password)):
                self.respond(401, {"error": "invalid_credentials"})
                return
            # This is a development login, not an OAuth password grant or authorization server.
            # The subject and scopes are selected by the server, never by request claims.
            self.respond(200, identity.token_response(subject=username))

        def respond(self, status, payload, allow=None):
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            if allow:
                self.send_header("Allow", allow)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_arguments):
            # Never log requests, query strings, headers, credentials or tokens.
            pass

    return HTTPServer((host, port), Handler)


def main():
    def stop(_signal, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        host, issuer = configuration()
        credentials = credentials_configuration()
        with tempfile.TemporaryDirectory(prefix="development-jwks-") as directory:
            identity = DevelopmentIdentity(directory, issuer)
            with make_server(identity, host=host, credentials=credentials) as server:
                print(f"Development-only identity provider listening on {host}:9000; do not expose publicly.",
                      flush=True)
                server.serve_forever()
    except KeyboardInterrupt:
        pass
    except (OSError, ValueError, subprocess.CalledProcessError):
        raise SystemExit("Cannot start development issuer; check configuration, development credentials, OpenSSL and port 9000.")


if __name__ == "__main__":
    main()
