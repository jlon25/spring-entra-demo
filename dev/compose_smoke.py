#!/usr/bin/env python3
"""Exercise a running Compose stack without printing access tokens or headers."""

import json
import os
import sys
import urllib.error
import urllib.request


def request(base_url, path, expected_status, bearer=None):
    headers = {"Accept": "application/json"}
    if bearer is not None:
        headers["Authorization"] = "Bearer " + bearer
    req = urllib.request.Request(base_url.rstrip("/") + path, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            status, body = response.status, response.read()
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
        body = b""
    except (OSError, urllib.error.URLError):
        raise RuntimeError("Cannot reach " + path) from None
    if status != expected_status:
        raise RuntimeError(path + ": expected HTTP " + str(expected_status)
                           + ", received " + str(status))
    if expected_status == 200:
        try:
            return json.loads(body)
        except (UnicodeError, ValueError):
            raise RuntimeError(path + ": invalid JSON response") from None
    return None


def verify_stack(api_base, identity_base):
    if request(api_base, "/public/ping", 200) != {"message": "pong"}:
        raise RuntimeError("Unexpected public ping response")
    request(api_base, "/api/message", 401)
    request(api_base, "/api/message", 401, "not-a-jwt")
    jwks = request(identity_base, "/jwks", 200)
    if not isinstance(jwks, dict) or not isinstance(jwks.get("keys"), list) or not jwks["keys"]:
        raise RuntimeError("JWKS must publish at least one public key")
    private_fields = {"d", "p", "q", "dp", "dq", "qi", "oth", "k"}
    for key in jwks["keys"]:
        if not isinstance(key, dict) or private_fields.intersection(key):
            raise RuntimeError("JWKS must contain only public keys")
        if key.get("kty") != "RSA" or not key.get("n") or not key.get("e"):
            raise RuntimeError("JWKS must contain an RSA public key")
    token_response = request(identity_base, "/token", 200)
    if not isinstance(token_response, dict) or token_response.get("token_type") != "Bearer":
        raise RuntimeError("Identity provider must return a Bearer token")
    bearer = token_response.get("access_token")
    if not isinstance(bearer, str) or not bearer:
        raise RuntimeError("Identity provider returned no access token")
    if request(api_base, "/api/message", 200, bearer) != {"message": "authenticated"}:
        raise RuntimeError("Unexpected authenticated API response")
    print("Compose smoke check passed: public ping, Bearer rejection, public JWKS and signed-token access")


def main():
    api_base = os.environ.get("API_BASE_URL", "http://127.0.0.1:8080")
    identity_base = os.environ.get("IDENTITY_BASE_URL", "http://127.0.0.1:9000")
    try:
        verify_stack(api_base, identity_base)
    except RuntimeError as error:
        print("Compose smoke check failed: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
