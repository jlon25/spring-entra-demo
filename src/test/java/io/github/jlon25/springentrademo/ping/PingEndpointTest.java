package io.github.jlon25.springentrademo.ping;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/** Exercises the real Bearer filter, decoder, signature verification and a local HTTP JWKS. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PingEndpointTest {

    private static final String ISSUER = "http://test-issuer.example";
    private static final String AUDIENCE = "spring-entra-demo";
    private static final RSAKey TRUSTED_KEY = key("trusted-test-key");
    private static final RSAKey OTHER_KEY = key("unknown-test-key");
    private static final AtomicInteger JWKS_REQUESTS = new AtomicInteger();
    private static final HttpServer JWKS = startJwks();

    @LocalServerPort
    private int port;

    @DynamicPropertySource
    static void jwtProperties(DynamicPropertyRegistry registry) {
        registry.add("app.security.jwt.issuer", () -> ISSUER);
        registry.add("app.security.jwt.audience", () -> AUDIENCE);
        registry.add("app.security.jwt.jwk-set-uri",
                () -> "http://127.0.0.1:" + JWKS.getAddress().getPort() + "/jwks");
    }

    @AfterAll
    static void stopJwks() {
        JWKS.stop(0);
    }

    @Test
    void pingReturnsPongAsJsonWithoutAuthentication() throws Exception {
        HttpResponse<String> response = get("/public/ping", null);
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Content-Type")).hasValueSatisfying(
                contentType -> assertThat(contentType).startsWith("application/json"));
        assertThat(response.body()).isEqualTo("{\"message\":\"pong\"}");
    }

    @Test
    void validSignedAccessTokenUsesJwksAndGrantsRequiredScope() throws Exception {
        HttpResponse<String> response = get("/api/message", token(builder -> { }));
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).isEqualTo("{\"message\":\"authenticated\"}");
        assertThat(JWKS_REQUESTS.get()).as("real HTTP JWKS requests").isPositive();
        assertThat(response.headers().firstValue("Set-Cookie")).isEmpty();
    }

    @Test
    void scpClaimAlsoMapsToScopeAuthorities() throws Exception {
        assertStatus(token(builder -> builder.claim("scope", null).claim("scp", "api.read")), 200);
    }

    @Test
    void protectedRouteWithoutTokenReturns401WithBearerChallenge() throws Exception {
        HttpResponse<String> response = get("/api/message", null);
        assertThat(response.statusCode()).isEqualTo(401);
        assertThat(response.headers().firstValue("WWW-Authenticate")).hasValueSatisfying(
                challenge -> assertThat(challenge).startsWith("Bearer"));
    }

    @Test
    void malformedTokenIsRejected() throws Exception {
        assertStatus("not-a-jwt", 401);
    }

    @Test
    void alteredSignatureIsRejected() throws Exception {
        String[] parts = token(builder -> { }).split("\\.");
        byte[] signature = Base64.getUrlDecoder().decode(parts[2]);
        signature[0] ^= 1;
        parts[2] = Base64.getUrlEncoder().withoutPadding().encodeToString(signature);
        assertStatus(String.join(".", parts), 401);
    }

    @Test
    void unknownSigningKeyIsRejected() throws Exception {
        assertStatus(sign(claims(), OTHER_KEY, JWSAlgorithm.RS256), 401);
    }

    @Test
    void algorithmOutsideAllowlistIsRejected() throws Exception {
        assertStatus(sign(claims(), TRUSTED_KEY, JWSAlgorithm.RS512), 401);
    }

    @Test
    void incorrectIssuerIsRejected() throws Exception {
        assertStatus(token(builder -> builder.issuer("http://untrusted.example")), 401);
    }

    @Test
    void missingIssuerIsRejected() throws Exception {
        assertStatus(token(builder -> builder.issuer(null)), 401);
    }

    @Test
    void tokenForAnotherAudienceIncludingAnIdTokenIsRejected() throws Exception {
        assertStatus(token(builder -> builder.audience("frontend-client-id")), 401);
    }

    @Test
    void missingAudienceIsRejected() throws Exception {
        assertStatus(token(builder -> builder.audience(java.util.List.of())), 401);
    }

    @Test
    void expiredTokenBeyondClockToleranceIsRejected() throws Exception {
        assertStatus(token(builder -> builder.expirationTime(Date.from(Instant.now().minusSeconds(120)))), 401);
    }

    @Test
    void missingExpirationIsRejected() throws Exception {
        assertStatus(token(builder -> builder.expirationTime(null)), 401);
    }

    @Test
    void futureNotBeforeBeyondClockToleranceIsRejected() throws Exception {
        assertStatus(token(builder -> builder.notBeforeTime(Date.from(Instant.now().plusSeconds(120)))), 401);
    }

    @Test
    void timestampsInsideClockToleranceAreAccepted() throws Exception {
        assertStatus(token(builder -> builder.expirationTime(Date.from(Instant.now().minusSeconds(30)))), 200);
        assertStatus(token(builder -> builder.notBeforeTime(Date.from(Instant.now().plusSeconds(30)))), 200);
    }

    @Test
    void missingScopeIsForbiddenForAuthenticatedIdentity() throws Exception {
        assertStatus(token(builder -> builder.claim("scope", null)), 403);
    }

    @Test
    void unrelatedScopeIsForbidden() throws Exception {
        assertStatus(token(builder -> builder.claim("scope", "api.write")), 403);
    }

    @Test
    void unknownRoutesRemainDeniedForAnonymousAndAuthenticatedRequests() throws Exception {
        assertThat(get("/public/does-not-exist", null).statusCode()).isEqualTo(401);
        assertThat(get("/public/does-not-exist", token(builder -> { })).statusCode()).isEqualTo(403);
    }

    private void assertStatus(String bearer, int expected) throws Exception {
        // Never include the bearer value or response error description in assertion output.
        assertThat(get("/api/message", bearer).statusCode()).isEqualTo(expected);
    }

    private HttpResponse<String> get(String path, String bearer) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + path))
                .timeout(Duration.ofSeconds(10)).GET();
        if (bearer != null) {
            request.header("Authorization", "Bearer " + bearer);
        }
        try (HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5)).build()) {
            return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
        }
    }

    private static String token(Consumer<JWTClaimsSet.Builder> customize) throws JOSEException {
        JWTClaimsSet.Builder builder = claims();
        customize.accept(builder);
        return sign(builder, TRUSTED_KEY, JWSAlgorithm.RS256);
    }

    private static JWTClaimsSet.Builder claims() {
        Instant now = Instant.now();
        return new JWTClaimsSet.Builder().issuer(ISSUER).audience(AUDIENCE)
                .subject("test-user").issueTime(Date.from(now.minusSeconds(300)))
                .expirationTime(Date.from(now.plusSeconds(300))).claim("scope", "api.read");
    }

    private static String sign(JWTClaimsSet.Builder claims, RSAKey key, JWSAlgorithm algorithm)
            throws JOSEException {
        SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(algorithm).keyID(key.getKeyID()).build(),
                claims.build());
        jwt.sign(new RSASSASigner(key));
        return jwt.serialize();
    }

    private static RSAKey key(String keyId) {
        try {
            return new RSAKeyGenerator(2048).keyID(keyId).generate();
        }
        catch (JOSEException ex) {
            throw new ExceptionInInitializerError("Cannot generate ephemeral test key");
        }
    }

    private static HttpServer startJwks() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            byte[] publicJwks = new JWKSet(TRUSTED_KEY.toPublicJWK()).toString()
                    .getBytes(StandardCharsets.UTF_8);
            server.createContext("/jwks", exchange -> {
                JWKS_REQUESTS.incrementAndGet();
                try (exchange) {
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.sendResponseHeaders(200, publicJwks.length);
                    exchange.getResponseBody().write(publicJwks);
                }
            });
            server.start();
            return server;
        }
        catch (IOException ex) {
            throw new ExceptionInInitializerError("Cannot start local JWKS fixture");
        }
    }
}
