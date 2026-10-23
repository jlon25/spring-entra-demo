#!/usr/bin/env python3
"""Development-only RS256 issuer. Requires Python 3.10+ and OpenSSL 3.x.

Run: python3 dev/identity_provider.py
The issuer is intentionally bound to loopback and must never be deployed.
"""

import base64
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
from http.server import BaseHTTPRequestHandler, HTTPServer


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

    def token_response(self):
        now = int(time.time())
        header = {"alg": "RS256", "typ": "JWT", "kid": self.jwk["kid"]}
        claims = {
            "iss": self.issuer, "aud": "spring-entra-demo", "sub": "local-user",
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


def make_server(identity, port=9000):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/jwks":
                self.respond(200, {"keys": [identity.jwk]})
            elif self.path == "/token":
                # Development convenience endpoint; not an OAuth authorization server.
                self.respond(200, identity.token_response())
            else:
                self.respond(404, {"error": "not_found"})

        def respond(self, status, payload):
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_arguments):
            # Never log requests, query strings, headers or tokens.
            pass

    return HTTPServer(("127.0.0.1", port), Handler)


def main():
    def stop(_signal, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        with tempfile.TemporaryDirectory(prefix="development-jwks-") as directory:
            identity = DevelopmentIdentity(directory)
            with make_server(identity) as server:
                print("Development identity provider: http://localhost:9000 (loopback only)",
                      flush=True)
                server.serve_forever()
    except KeyboardInterrupt:
        pass
    except (OSError, subprocess.CalledProcessError):
        raise SystemExit("Cannot start local issuer; check OpenSSL and loopback port 9000.")


if __name__ == "__main__":
    main()
