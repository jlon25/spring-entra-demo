"""No Microsoft calls, persistent keys or printed tokens."""

import base64
import json
import http.client
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from identity_provider import (DevelopmentIdentity, configuration, credentials_configuration,
                               credentials_match, make_server, openssl)


TEST_CREDENTIALS = ("test-local-user", "test-only-password-123")


def decode(value):
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class IdentityProviderTest(unittest.TestCase):
    def test_standalone_defaults_remain_loopback_and_local_issuer(self):
        self.assertEqual(configuration({}), ("127.0.0.1", "http://localhost:9000"))

    def test_explicit_container_binding_and_issuer(self):
        self.assertEqual(configuration({"DEV_IDENTITY_BIND_ADDRESS": "0.0.0.0",
                                        "DEV_IDENTITY_ISSUER": "http://identity:9000"}),
                         ("0.0.0.0", "http://identity:9000"))

    def test_invalid_bind_addresses_are_rejected(self):
        for host in ("", "localhost", "::1", "invalid", "0.0.0.0:9000"):
            with self.subTest(host=host), self.assertRaises(ValueError):
                configuration({"DEV_IDENTITY_BIND_ADDRESS": host})

    def test_invalid_issuers_are_rejected(self):
        for issuer in ("", "/relative", "ftp://identity", "http://user:password@identity", "http://@identity",
                       "http://identity?aud=other", "http://identity#fragment", "http://identity?",
                       "http://identity#", "http://identity:invalid", "http://identity:99999",
                       "http://identity with spaces", "http:///missing-host"):
            with self.subTest(issuer=issuer), self.assertRaises(ValueError):
                configuration({"DEV_IDENTITY_ISSUER": issuer})

    def test_server_defaults_to_loopback_but_accepts_explicit_container_binding(self):
        with patch("identity_provider.HTTPServer") as server:
            make_server(None, 0, credentials=TEST_CREDENTIALS)
            self.assertEqual(server.call_args.args[0], ("127.0.0.1", 0))
            make_server(None, 0, host="0.0.0.0", credentials=TEST_CREDENTIALS)
            self.assertEqual(server.call_args.args[0], ("0.0.0.0", 0))

    def test_configured_issuer_is_used_in_signed_token(self):
        with tempfile.TemporaryDirectory() as directory:
            _, issuer = configuration({"DEV_IDENTITY_ISSUER": "http://identity:9000"})
            identity = DevelopmentIdentity(directory, issuer)
            claims = identity.token_response()["access_token"].split(".")[1]
            self.assertEqual(json.loads(decode(claims))["iss"], "http://identity:9000")

    def test_credentials_configuration_requires_explicit_password(self):
        for values in ({}, {"DEV_IDENTITY_PASSWORD": ""}, {"DEV_IDENTITY_PASSWORD": "short"}):
            with self.subTest(case=bool(values)), self.assertRaises(ValueError):
                credentials_configuration(values)
        self.assertEqual(credentials_configuration({"DEV_IDENTITY_PASSWORD": TEST_CREDENTIALS[1]}),
                         ("local-user", TEST_CREDENTIALS[1]))
        self.assertEqual(credentials_configuration({"DEV_IDENTITY_USERNAME": TEST_CREDENTIALS[0],
                                                   "DEV_IDENTITY_PASSWORD": TEST_CREDENTIALS[1]}),
                         TEST_CREDENTIALS)

    def test_invalid_account_configuration_is_rejected(self):
        for username in ("", " ", "x" * 129, "bad\nname", "bad\ud800name"):
            with self.subTest(case="invalid username"), self.assertRaises(ValueError):
                credentials_configuration({"DEV_IDENTITY_USERNAME": username,
                                           "DEV_IDENTITY_PASSWORD": TEST_CREDENTIALS[1]})

    def test_credentials_are_checked_and_both_fields_must_match(self):
        self.assertTrue(credentials_match(TEST_CREDENTIALS, TEST_CREDENTIALS))
        self.assertFalse(credentials_match(("other-user", TEST_CREDENTIALS[1]), TEST_CREDENTIALS))
        self.assertFalse(credentials_match((TEST_CREDENTIALS[0], "incorrect-password"), TEST_CREDENTIALS))
        with patch("identity_provider.hmac.compare_digest", side_effect=[False, True]) as compare:
            self.assertFalse(credentials_match(TEST_CREDENTIALS, TEST_CREDENTIALS))
            self.assertEqual(compare.call_count, 2)

    def test_server_requires_explicit_credentials(self):
        with self.assertRaises(TypeError):
            make_server(None, 0)
        with self.assertRaises(ValueError):
            make_server(None, 0, credentials=None)

    def test_signed_token_subject_is_authenticated_username(self):
        with tempfile.TemporaryDirectory() as directory:
            identity = DevelopmentIdentity(directory)
            response = identity.token_response(subject=TEST_CREDENTIALS[0])
            payload = json.loads(decode(response["access_token"].split(".")[1]))
            self.assertEqual(payload["sub"], TEST_CREDENTIALS[0])
            self.assertEqual(payload["scope"], "api.read")

    def test_loopback_http_login_and_input_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            identity = DevelopmentIdentity(directory)
            with make_server(identity, 0, credentials=TEST_CREDENTIALS) as server:
                worker = threading.Thread(target=server.serve_forever, daemon=True)
                worker.start()
                try:
                    client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                    base = "http://127.0.0.1:" + str(server.server_port)

                    def request(path, status, payload=None, content_type="application/json", raw=None):
                        body = json.dumps(payload).encode() if payload is not None else raw
                        headers = {"Content-Type": content_type} if body is not None else {}
                        req = urllib.request.Request(base + path, data=body, headers=headers)
                        try:
                            response = client.open(req, timeout=3)
                        except urllib.error.HTTPError as error:
                            response = error
                        with response:
                            self.assertEqual(response.code, status)
                            data = response.read()
                            self.assertEqual(response.headers["Cache-Control"], "no-store")
                            return response.headers, json.loads(data)

                    _, jwks = request("/jwks", 200)
                    self.assertEqual(jwks, {"keys": [identity.jwk]})
                    headers, denied = request("/token", 405)
                    self.assertEqual(headers["Allow"], "POST")
                    self.assertEqual(denied, {"error": "method_not_allowed"})
                    request("/unknown", 404)
                    request("/token?aud=other-api", 404)
                    credentials = dict(zip(("username", "password"), TEST_CREDENTIALS))
                    _, token = request("/token", 200, credentials)
                    self.assertEqual(token["token_type"], "Bearer")
                    self.assertEqual(token["expires_in"], 300)
                    claims = json.loads(decode(token["access_token"].split(".")[1]))
                    self.assertEqual(claims["sub"], TEST_CREDENTIALS[0])
                    self.assertEqual(claims["scope"], "api.read")
                    bad_cases = ({"username": "unknown", "password": TEST_CREDENTIALS[1]},
                                 {"username": TEST_CREDENTIALS[0], "password": "incorrect"})
                    for bad in bad_cases:
                        _, error = request("/token", 401, bad)
                        self.assertEqual(error, {"error": "invalid_credentials"})
                    invalid = ({}, {"username": TEST_CREDENTIALS[0]}, {"username": 1, "password": "x"},
                               {**credentials, "scope": "admin"}, {**credentials, "sub": "admin"},
                               {"username": "bad\ud800", "password": TEST_CREDENTIALS[1]})
                    for payload in invalid:
                        _, error = request("/token", 400, payload)
                        self.assertEqual(error, {"error": "invalid_request"})
                    request("/token", 400, raw=b"not-json")
                    request("/token", 415, credentials, content_type="text/plain")
                    request("/token", 413, raw=b"x" * 4097)
                    connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
                    try:
                        connection.putrequest("POST", "/token")
                        connection.putheader("Content-Type", "application/json")
                        connection.endheaders()
                        response = connection.getresponse()
                        self.assertEqual(response.status, 411)
                        self.assertEqual(json.loads(response.read()), {"error": "length_required"})
                    finally:
                        connection.close()
                finally:
                    server.shutdown()
                    worker.join(timeout=3)

    def test_jwks_matches_real_rs256_signature_and_claims(self):
        with tempfile.TemporaryDirectory() as directory:
            identity = DevelopmentIdentity(directory)
            response = identity.token_response()
            header, claims, signature = response["access_token"].split(".")
            self.assertEqual(json.loads(decode(header))["alg"], "RS256")
            payload = json.loads(decode(claims))
            self.assertEqual(payload["iss"], "http://localhost:9000")
            self.assertEqual(payload["aud"], "spring-entra-demo")
            self.assertEqual(payload["scope"], "api.read")
            self.assertEqual(payload["exp"] - payload["iat"], 300)
            self.assertEqual(set(identity.jwk), {"kty", "use", "alg", "kid", "n", "e"})
            self.assertEqual(int.from_bytes(decode(identity.jwk["e"]), "big"), 65537)
            public = Path(directory) / "public.pem"
            public.write_bytes(openssl("pkey", "-in", str(identity.private_key), "-pubout"))
            actual_modulus = openssl("rsa", "-pubin", "-in", str(public), "-modulus", "-noout")
            self.assertEqual(int.from_bytes(decode(identity.jwk["n"]), "big"),
                             int(actual_modulus.decode().strip().split("=")[1], 16))
            signature_path = Path(directory) / "signature.bin"
            signature_path.write_bytes(decode(signature))
            result = openssl("dgst", "-sha256", "-verify", str(public),
                             "-signature", str(signature_path),
                             data=(header + "." + claims).encode("ascii"))
            self.assertEqual(result.strip(), b"Verified OK")


if __name__ == "__main__":
    unittest.main()
