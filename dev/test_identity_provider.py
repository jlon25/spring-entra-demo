"""No Microsoft calls, persistent keys or printed tokens."""

import base64
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from identity_provider import DevelopmentIdentity, configuration, make_server, openssl


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
            make_server(None, 0)
            self.assertEqual(server.call_args.args[0], ("127.0.0.1", 0))
            make_server(None, 0, host="0.0.0.0")
            self.assertEqual(server.call_args.args[0], ("0.0.0.0", 0))

    def test_configured_issuer_is_used_in_signed_token(self):
        with tempfile.TemporaryDirectory() as directory:
            _, issuer = configuration({"DEV_IDENTITY_ISSUER": "http://identity:9000"})
            identity = DevelopmentIdentity(directory, issuer)
            claims = identity.token_response()["access_token"].split(".")[1]
            self.assertEqual(json.loads(decode(claims))["iss"], "http://identity:9000")

    def test_loopback_http_endpoints(self):
        with tempfile.TemporaryDirectory() as directory:
            identity = DevelopmentIdentity(directory)
            with make_server(identity, 0) as server:
                worker = threading.Thread(target=server.serve_forever, daemon=True)
                worker.start()
                try:
                    # Keep local test traffic local even when the host sets HTTP_PROXY.
                    client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                    base = "http://127.0.0.1:" + str(server.server_port)
                    with client.open(base + "/jwks", timeout=3) as response:
                        self.assertEqual(response.status, 200)
                        self.assertEqual(json.load(response), {"keys": [identity.jwk]})
                    with client.open(base + "/token", timeout=3) as response:
                        self.assertEqual(response.headers["Cache-Control"], "no-store")
                        payload = json.load(response)
                        self.assertEqual(payload["token_type"], "Bearer")
                        self.assertEqual(payload["expires_in"], 300)
                        self.assertEqual(len(payload["access_token"].split(".")), 3)
                    with self.assertRaises(urllib.error.HTTPError) as missing:
                        client.open(base + "/unknown", timeout=3)
                    self.assertEqual(missing.exception.code, 404)
                    missing.exception.close()
                    with self.assertRaises(urllib.error.HTTPError) as parameters:
                        client.open(base + "/token?aud=other-api", timeout=3)
                    self.assertEqual(parameters.exception.code, 404)
                    parameters.exception.close()
                    post = urllib.request.Request(base + "/token", data=b"", method="POST")
                    with self.assertRaises(urllib.error.HTTPError) as method:
                        client.open(post, timeout=3)
                    self.assertEqual(method.exception.code, 501)
                    method.exception.close()
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
