package io.github.jlon25.springentrademo.hearingtype;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

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
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Real HTTP, signed JWT/JWKS and PostgreSQL; run against an isolated DB with -Ppostgres-it. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("postgres")
class HearingTypeApiIT {

    private static final String PATH = "/api/hearing-types";
    private static final String READ = "hearing-types.read";
    private static final String WRITE = "hearing-types.write";
    private static final String BOTH = READ + " " + WRITE;
    private static final String ISSUER = "http://hearing-type-test.example";
    private static final String AUDIENCE = "spring-entra-demo";
    private static final RSAKey KEY = key();
    private static final HttpServer JWKS = startJwks();
    private static final JsonMapper JSON = JsonMapper.builder().build();

    @LocalServerPort
    private int port;

    @Autowired
    private Flyway flyway;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("app.security.jwt.issuer", () -> ISSUER);
        registry.add("app.security.jwt.audience", () -> AUDIENCE);
        registry.add("app.security.jwt.jwk-set-uri",
                () -> "http://127.0.0.1:" + JWKS.getAddress().getPort() + "/jwks");
        registry.add("spring.datasource.url", () -> required("TEST_DB_URL"));
        registry.add("spring.datasource.username", () -> "auditions_app");
        registry.add("spring.datasource.password", () -> required("TEST_DB_APP_PASSWORD"));
        registry.add("spring.flyway.url", () -> required("TEST_DB_URL"));
        registry.add("spring.flyway.user", () -> "auditions_migrator");
        registry.add("spring.flyway.password", () -> required("TEST_DB_MIGRATION_PASSWORD"));
    }

    @AfterAll
    static void stopJwks() {
        JWKS.stop(0);
    }

    @Test
    void createReadUpdateAndListUsePersistedValuesAndVersions() throws Exception {
        String label = "Fictitious-" + UUID.randomUUID();
        Map<String, Object> payload = validPayload("  " + label + "  ");
        HttpResponse<String> created = request("POST", PATH, payload, token(BOTH));
        assertThat(created.statusCode()).isEqualTo(201);
        Map<?, ?> resource = object(created);
        String id = resource.get("id").toString();
        assertThat(UUID.fromString(id)).isNotNull();
        assertThat(created.headers().firstValue("Location")).hasValue(PATH + "/" + id);
        assertThat(resource.get("label")).isEqualTo(label);
        assertThat(number(resource, "version")).isZero();
        assertThat(resource.get("defenderRequired")).isEqualTo(true);
        assertThat(number(resource, "durationMinutes")).isEqualTo(60);
        assertThat(number(resource, "pauseMinutes")).isEqualTo(15);

        HttpResponse<String> read = request("GET", PATH + "/" + id, null, token(READ));
        assertThat(read.statusCode()).isEqualTo(200);
        assertThat(object(read)).isEqualTo(resource);
        try (Connection connection = appConnection();
                var statement = connection.prepareStatement(
                        "SELECT label, version FROM auditions.hearing_type WHERE id = ?")) {
            statement.setObject(1, UUID.fromString(id));
            try (var rows = statement.executeQuery()) {
                assertThat(rows.next()).isTrue();
                assertThat(rows.getString("label")).isEqualTo(label);
                assertThat(rows.getLong("version")).isZero();
            }
        }

        payload.put("label", label + " updated");
        payload.put("durationMinutes", 75);
        payload.put("pauseMinutes", 20);
        payload.put("defenderRequired", false);
        payload.put("version", 0);
        HttpResponse<String> updated = request("PUT", PATH + "/" + id, payload, token(WRITE));
        assertThat(updated.statusCode()).isEqualTo(200);
        Map<?, ?> changed = object(updated);
        assertThat(changed.get("id")).isEqualTo(id);
        assertThat(changed.get("label")).isEqualTo(label + " updated");
        assertThat(number(changed, "version")).isEqualTo(1);
        assertThat(number(changed, "durationMinutes")).isEqualTo(75);
        assertThat(number(changed, "pauseMinutes")).isEqualTo(20);
        assertThat(changed.get("defenderRequired")).isEqualTo(false);

        HttpResponse<String> listed = request("GET", PATH, null, token(READ));
        assertThat(listed.statusCode()).isEqualTo(200);
        List<?> resources = JSON.readValue(listed.body(), List.class);
        assertThat(resources.stream().filter(Map.class::isInstance)
                .map(Map.class::cast).anyMatch(item -> id.equals(item.get("id")))).isTrue();
    }

    @Test
    void realBearerAuthenticationAndDistinctScopesAreEnforced() throws Exception {
        assertThat(request("GET", PATH, null, null).statusCode()).isEqualTo(401);
        assertThat(request("POST", PATH, validPayload("Fictitious"), null).statusCode()).isEqualTo(401);
        assertThat(request("GET", PATH, null, "not-a-jwt").statusCode()).isEqualTo(401);
        String[] parts = token(READ).split("\\.");
        byte[] signature = Base64.getUrlDecoder().decode(parts[2]);
        signature[0] ^= 1;
        parts[2] = Base64.getUrlEncoder().withoutPadding().encodeToString(signature);
        assertThat(request("GET", PATH, null, String.join(".", parts)).statusCode()).isEqualTo(401);
        assertThat(request("GET", PATH, null, token("api.read")).statusCode()).isEqualTo(403);
        assertThat(request("POST", PATH, validPayload("Fictitious"), token("api.read"))
                .statusCode()).isEqualTo(403);
        assertThat(request("GET", PATH, null, token(READ)).statusCode()).isEqualTo(200);
        assertThat(request("POST", PATH, validPayload("Fictitious"), token(READ))
                .statusCode()).isEqualTo(403);
        Map<String, Object> update = validPayload("Fictitious");
        update.put("version", 0);
        assertThat(request("PUT", PATH + "/" + UUID.randomUUID(), update, token(READ))
                .statusCode()).isEqualTo(403);
        assertThat(request("GET", PATH, null, token(WRITE)).statusCode()).isEqualTo(403);
        HttpResponse<String> created = request("POST", PATH,
                validPayload("Fictitious-write-only-" + UUID.randomUUID()), token(WRITE));
        assertThat(created.statusCode()).isEqualTo(201);
        String id = object(created).get("id").toString();
        assertThat(request("PUT", PATH + "/" + id, update, token(WRITE)).statusCode()).isEqualTo(200);
        assertThat(request("DELETE", PATH + "/" + id, null, token(BOTH)).statusCode()).isEqualTo(403);
    }

    @Test
    void invalidFieldsAndMalformedJsonAreRejectedWithoutInserts() throws Exception {
        long before = count();
        List<Map<String, Object>> invalid = new ArrayList<>();
        invalid.add(Map.of());
        for (String field : List.of("label", "durationMinutes", "pauseMinutes", "defenderRequired")) {
            Map<String, Object> missing = validPayload("Fictitious-validation");
            missing.remove(field);
            invalid.add(missing);
            Map<String, Object> nullValue = validPayload("Fictitious-validation");
            nullValue.put(field, null);
            invalid.add(nullValue);
        }
        for (String label : List.of("", "   ", "x".repeat(121))) {
            invalid.add(validPayload(label));
        }
        for (Object label : List.of(123, true)) {
            Map<String, Object> payload = validPayload("Fictitious-validation");
            payload.put("label", label);
            invalid.add(payload);
        }
        for (String field : List.of("durationMinutes", "pauseMinutes")) {
            Map<String, Object> payload = validPayload("Fictitious-validation");
            payload.put(field, field.equals("durationMinutes") ? "60" : "15");
            invalid.add(payload);
        }
        for (Object defenderRequired : List.of("true", 1)) {
            Map<String, Object> payload = validPayload("Fictitious-validation");
            payload.put("defenderRequired", defenderRequired);
            invalid.add(payload);
        }
        for (String unknown : List.of("id", "version", "unknownField")) {
            Map<String, Object> payload = validPayload("Fictitious-validation");
            payload.put(unknown, unknown.equals("id") ? UUID.randomUUID().toString() : 0);
            invalid.add(payload);
        }
        for (String field : List.of("durationMinutes", "pauseMinutes")) {
            for (Object value : List.of(0, -1, 1.5, 2147483648L)) {
                Map<String, Object> payload = validPayload("Fictitious-validation");
                payload.put(field, value);
                invalid.add(payload);
            }
        }
        for (Map<String, Object> payload : invalid) {
            assertProblem(request("POST", PATH, payload, token(WRITE)), 400);
        }
        assertProblem(rawRequest("POST", PATH, "{", token(WRITE)), 400);
        assertThat(count()).isEqualTo(before);

        HttpResponse<String> fieldError = request("POST", PATH, validPayload(" "), token(WRITE));
        assertThat(object(fieldError).get("errors")).isInstanceOf(List.class);
    }

    @Test
    void updateRequiresValidVersionAndLeavesCurrentResourceUnchanged() throws Exception {
        Map<?, ?> created = create();
        String path = PATH + "/" + created.get("id");
        Map<String, Object> payload = validPayload("Fictitious-update-validation");
        assertProblem(request("PUT", path, payload, token(WRITE)), 400);
        for (Object version : List.of(-1, 0.5, "not-a-number")) {
            payload.put("version", version);
            assertProblem(request("PUT", path, payload, token(WRITE)), 400);
        }
        payload.put("version", null);
        assertProblem(request("PUT", path, payload, token(WRITE)), 400);
        payload.put("version", 0);
        payload.put("pauseMinutes", 0);
        assertProblem(request("PUT", path, payload, token(WRITE)), 400);
        assertThat(object(request("GET", path, null, token(READ)))).isEqualTo(created);
    }

    @Test
    void absentInvalidAndStaleReferencesHaveDistinctErrors() throws Exception {
        String missing = PATH + "/" + UUID.randomUUID();
        assertProblem(request("GET", missing, null, token(READ)), 404);
        assertProblem(request("GET", PATH + "/not-a-uuid", null, token(READ)), 400);
        Map<String, Object> payload = validPayload("Fictitious-missing");
        payload.put("version", 0);
        assertProblem(request("PUT", missing, payload, token(WRITE)), 404);
        Map<?, ?> created = create();
        String path = PATH + "/" + created.get("id");
        assertThat(request("PUT", path, payload, token(WRITE)).statusCode()).isEqualTo(200);
        assertProblem(request("PUT", path, payload, token(WRITE)), 409);
        assertThat(number(object(request("GET", path, null, token(READ))), "version")).isEqualTo(1);
    }

    @Test
    void twoConcurrentUpdatesOfSameVersionCannotOverwriteEachOther() throws Exception {
        Map<?, ?> created = create();
        String path = PATH + "/" + created.get("id");
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        String bearer = token(WRITE);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> concurrentUpdate(path, 61, bearer, ready, start));
            var second = executor.submit(() -> concurrentUpdate(path, 62, bearer, ready, start));
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(200, 409);
        }
        Map<?, ?> result = object(request("GET", path, null, token(READ)));
        assertThat(number(result, "version")).isEqualTo(1);
        assertThat(number(result, "durationMinutes")).isIn(61L, 62L);
    }

    @Test
    void applicationAccountCannotChangeSchemaDeleteOrWriteFlywayHistory() throws Exception {
        try (Connection connection = appConnection(); var statement = connection.createStatement()) {
            try (var rows = statement.executeQuery(
                    "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user")) {
                assertThat(rows.next()).isTrue();
                assertThat(rows.getString("rolname")).isEqualTo("auditions_app");
                assertThat(rows.getBoolean("rolsuper")).isFalse();
                assertThat(rows.getBoolean("rolcreatedb")).isFalse();
                assertThat(rows.getBoolean("rolcreaterole")).isFalse();
            }
            for (String sql : List.of(
                    "CREATE TABLE auditions.forbidden_test (id integer)",
                    "DELETE FROM auditions.hearing_type WHERE false",
                    "UPDATE auditions.flyway_schema_history SET success = false WHERE false")) {
                assertThatThrownBy(() -> statement.execute(sql)).isInstanceOfSatisfying(SQLException.class,
                        error -> assertThat(error.getSQLState()).isEqualTo("42501"));
            }
        }
    }

    @Test
    void databaseConstraintsAlsoRejectInvalidWritesOutsideHttp() throws Exception {
        try (Connection connection = migratorConnection()) {
            for (Object[] values : List.of(
                    new Object[] {"", 60, 15, true, 0L},
                    new Object[] {"   ", 60, 15, true, 0L},
                    new Object[] {"Fictitious", 0, 15, true, 0L},
                    new Object[] {"Fictitious", -1, 15, true, 0L},
                    new Object[] {"Fictitious", 60, 0, true, 0L},
                    new Object[] {"Fictitious", 60, -1, true, 0L},
                    new Object[] {"Fictitious", 60, 15, true, -1L})) {
                assertSqlInsertRejected(connection, values, "23514");
            }
            assertSqlInsertRejected(connection, new Object[] {null, 60, 15, true, 0L}, "23502");
            assertSqlInsertRejected(connection, new Object[] {"x".repeat(121), 60, 15, true, 0L}, "22001");
        }
    }

    @Test
    void migrationIsRecordedOnceAndSecondMigrationIsANoOp() throws Exception {
        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
        assertThat(flyway.migrate().migrationsExecuted).isZero();
        try (Connection connection = migratorConnection(); var statement = connection.createStatement();
                var rows = statement.executeQuery(
                        "SELECT count(*) FROM auditions.flyway_schema_history WHERE version = '1' AND success")) {
            assertThat(rows.next()).isTrue();
            assertThat(rows.getInt(1)).isEqualTo(1);
        }
    }

    private int concurrentUpdate(String path, int duration, String bearer,
            CountDownLatch ready, CountDownLatch start) throws Exception {
        Map<String, Object> payload = validPayload("Fictitious-concurrent");
        payload.put("durationMinutes", duration);
        payload.put("version", 0);
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) {
            throw new IllegalStateException("Concurrent test start was not released");
        }
        return request("PUT", path, payload, bearer).statusCode();
    }

    private Map<?, ?> create() throws Exception {
        HttpResponse<String> response = request("POST", PATH,
                validPayload("Fictitious-" + UUID.randomUUID()), token(BOTH));
        assertThat(response.statusCode()).isEqualTo(201);
        return object(response);
    }

    private static Map<String, Object> validPayload(String label) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("label", label);
        payload.put("durationMinutes", 60);
        payload.put("pauseMinutes", 15);
        payload.put("defenderRequired", true);
        return payload;
    }

    private void assertProblem(HttpResponse<String> response, int status) throws Exception {
        assertThat(response.statusCode()).isEqualTo(status);
        assertThat(response.headers().firstValue("Content-Type"))
                .hasValueSatisfying(value -> assertThat(value).startsWith("application/problem+json"));
        assertThat(number(object(response), "status")).isEqualTo(status);
        for (String forbidden : List.of("exception", "trace", "stackTrace", "rejectedValue")) {
            assertThat(object(response).containsKey(forbidden)).isFalse();
        }
    }

    private HttpResponse<String> request(String method, String path, Object body, String bearer) throws Exception {
        return rawRequest(method, path, body == null ? null : JSON.writeValueAsString(body), bearer);
    }

    private HttpResponse<String> rawRequest(String method, String path, String body, String bearer) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(10));
        request.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        if (body != null) {
            request.header("Content-Type", "application/json");
        }
        if (bearer != null) {
            request.header("Authorization", "Bearer " + bearer);
        }
        try (HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()) {
            return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
        }
    }

    private static Map<?, ?> object(HttpResponse<String> response) throws Exception {
        return JSON.readValue(response.body(), Map.class);
    }

    private static long number(Map<?, ?> resource, String name) {
        return ((Number) resource.get(name)).longValue();
    }

    private static Connection appConnection() throws SQLException {
        return DriverManager.getConnection(required("TEST_DB_URL"), "auditions_app", required("TEST_DB_APP_PASSWORD"));
    }

    private static Connection migratorConnection() throws SQLException {
        return DriverManager.getConnection(required("TEST_DB_URL"), "auditions_migrator",
                required("TEST_DB_MIGRATION_PASSWORD"));
    }

    private static long count() throws SQLException {
        try (Connection connection = appConnection(); var statement = connection.createStatement();
                var rows = statement.executeQuery("SELECT count(*) FROM auditions.hearing_type")) {
            rows.next();
            return rows.getLong(1);
        }
    }

    private static void assertSqlInsertRejected(Connection connection, Object[] values, String sqlState) throws SQLException {
        try (var statement = connection.prepareStatement("""
                INSERT INTO auditions.hearing_type
                    (id, label, duration_minutes, pause_minutes, defender_required, version)
                VALUES (?, ?, ?, ?, ?, ?)
                """)) {
            statement.setObject(1, UUID.randomUUID());
            for (int index = 0; index < values.length; index++) {
                statement.setObject(index + 2, values[index]);
            }
            assertThatThrownBy(statement::executeUpdate).isInstanceOfSatisfying(SQLException.class,
                    error -> assertThat(error.getSQLState()).isEqualTo(sqlState));
        }
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing isolated integration-test setting: " + name);
        }
        return value;
    }

    private static String token(String scopes) throws JOSEException {
        Instant now = Instant.now();
        JWTClaimsSet claims = new JWTClaimsSet.Builder().issuer(ISSUER).audience(AUDIENCE)
                .subject("fictitious-test-user").issueTime(Date.from(now))
                .expirationTime(Date.from(now.plusSeconds(300))).claim("scope", scopes).build();
        SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(KEY.getKeyID()).build(), claims);
        jwt.sign(new RSASSASigner(KEY));
        return jwt.serialize();
    }

    private static RSAKey key() {
        try {
            return new RSAKeyGenerator(2048).keyID("ephemeral-hearing-test").generate();
        }
        catch (JOSEException error) {
            throw new ExceptionInInitializerError("Cannot generate ephemeral integration-test key");
        }
    }

    private static HttpServer startJwks() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            byte[] publicKeys = new JWKSet(KEY.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);
            server.createContext("/jwks", exchange -> {
                try (exchange) {
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.sendResponseHeaders(200, publicKeys.length);
                    exchange.getResponseBody().write(publicKeys);
                }
            });
            server.start();
            return server;
        }
        catch (IOException error) {
            throw new ExceptionInInitializerError("Cannot start local integration-test JWKS");
        }
    }
}
