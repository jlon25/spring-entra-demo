package io.github.jlon25.springentrademo.heardperson;

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

import io.github.jlon25.springentrademo.support.PostgresIntegrationFixture;

/** Real HTTP, PostgreSQL and ephemeral signed JWT/JWKS; only disposable test databases. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("postgres")
class HeardPersonApiIT {

    private static final String PATH = "/api/heard-persons";
    private static final String READ = "heard-persons.read";
    private static final String WRITE = "heard-persons.write";
    private static final String BOTH = READ + " " + WRITE;
    private static final String ISSUER = "http://heard-person-test.example";
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
        PostgresIntegrationFixture.prepareVersionThree();
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
    void createReadUpdateAndListPersistOnlyTheMinimalReferenceAndStatus() throws Exception {
        String reference = "Fictitious-person-" + UUID.randomUUID();
        HttpResponse<String> response = request("POST", PATH, payload("  " + reference + "  ", "UNKNOWN"), token(WRITE));
        assertThat(response.statusCode()).isEqualTo(201);
        Map<?, ?> created = object(response);
        String path = PATH + "/" + created.get("id");
        assertThat(response.headers().firstValue("Location")).hasValue(path);
        assertThat(created.keySet().stream().map(Object::toString).toList())
                .containsExactlyInAnyOrder("id", "reference", "minorityStatus", "version");
        assertThat(created.get("reference")).isEqualTo(reference);
        assertThat(created.get("minorityStatus")).isEqualTo("UNKNOWN");
        assertThat(number(created, "version")).isZero();
        assertThat(object(request("GET", path, null, token(READ)))).isEqualTo(created);
        List<?> listed = JSON.readValue(request("GET", PATH, null, token(READ)).body(), List.class);
        assertThat(listed.stream().filter(Map.class::isInstance).map(Map.class::cast)
                .anyMatch(row -> created.get("id").equals(row.get("id")))).isTrue();

        Map<String, Object> update = payload(reference, "MINOR");
        update.put("version", 0);
        HttpResponse<String> saved = request("PUT", path, update, token(WRITE));
        assertThat(saved.statusCode()).isEqualTo(200);
        assertThat(object(saved).get("minorityStatus")).isEqualTo("MINOR");
        assertThat(number(object(saved), "version")).isEqualTo(1);
        update.put("minorityStatus", "ADULT");
        update.put("version", 1);
        assertThat(request("PUT", path, update, token(WRITE)).statusCode()).isEqualTo(200);
        try (Connection connection = appConnection(); var statement = connection.prepareStatement(
                "SELECT reference, minority_status, version FROM auditions.heard_person WHERE id = ?")) {
            statement.setObject(1, UUID.fromString(created.get("id").toString()));
            try (var rows = statement.executeQuery()) {
                assertThat(rows.next()).isTrue();
                assertThat(rows.getString(1)).isEqualTo(reference);
                assertThat(rows.getString(2)).isEqualTo("ADULT");
                assertThat(rows.getLong(3)).isEqualTo(2);
            }
        }
    }

    @Test
    void realJwtAndDistinctPersonPermissionsAreRequired() throws Exception {
        Map<?, ?> created = create();
        String path = PATH + "/" + created.get("id");
        Map<String, Object> update = payload(created.get("reference").toString(), "MINOR");
        update.put("version", 0);
        assertThat(request("GET", PATH, null, null).statusCode()).isEqualTo(401);
        assertThat(request("GET", path, null, "invalid-jwt").statusCode()).isEqualTo(401);
        assertThat(request("POST", PATH, payload("Fictitious", "UNKNOWN"), null).statusCode()).isEqualTo(401);
        assertThat(request("PUT", path, update, null).statusCode()).isEqualTo(401);
        assertThat(request("GET", PATH, null, token("api.read")).statusCode()).isEqualTo(403);
        assertThat(request("GET", PATH, null, token("hearing-types.read hearing-types.write")).statusCode())
                .isEqualTo(403);
        assertThat(request("GET", path, null, token(WRITE)).statusCode()).isEqualTo(403);
        assertThat(request("POST", PATH, payload("Fictitious", "UNKNOWN"), token(READ)).statusCode()).isEqualTo(403);
        assertThat(request("PUT", path, update, token(READ)).statusCode()).isEqualTo(403);
        assertThat(request("GET", PATH, null, token(READ)).statusCode()).isEqualTo(200);
        assertThat(request("PUT", path, update, token(WRITE)).statusCode()).isEqualTo(200);
        assertThat(request("DELETE", path, null, token(BOTH)).statusCode()).isEqualTo(403);
        assertThat(request("PATCH", path, null, token(BOTH)).statusCode()).isEqualTo(403);
    }

    @Test
    void invalidReferencesStatusesAndCivilIdentityFieldsAreRejectedWithoutEchoingValues() throws Exception {
        long before = count();
        List<Map<String, Object>> invalid = new ArrayList<>();
        invalid.add(Map.of());
        for (String field : List.of("reference", "minorityStatus")) {
            Map<String, Object> missing = payload("Fictitious-validation", "UNKNOWN");
            missing.remove(field);
            invalid.add(missing);
            Map<String, Object> nullValue = payload("Fictitious-validation", "UNKNOWN");
            nullValue.put(field, null);
            invalid.add(nullValue);
        }
        for (Object reference : List.of("", "   ", "x".repeat(121), 123, true)) {
            Map<String, Object> item = payload("Fictitious-validation", "UNKNOWN");
            item.put("reference", reference);
            invalid.add(item);
        }
        for (Object status : List.of("", "minor", "CHILD", 0, 1, 1.5, true, "0")) {
            Map<String, Object> item = payload("Fictitious-validation", "UNKNOWN");
            item.put("minorityStatus", status);
            invalid.add(item);
        }
        for (String field : List.of("name", "firstName", "lastName", "dateOfBirth", "birthDate", "gender", "language", "id", "version")) {
            Map<String, Object> item = payload("Fictitious-validation", "UNKNOWN");
            item.put(field, "DO_NOT_ECHO_PERSONAL_DATA");
            invalid.add(item);
        }
        for (Map<String, Object> item : invalid) {
            HttpResponse<String> response = request("POST", PATH, item, token(WRITE));
            assertProblem(response, 400);
            assertThat(response.body()).doesNotContain("DO_NOT_ECHO_PERSONAL_DATA");
        }
        assertProblem(rawRequest("POST", PATH, "{", token(WRITE)), 400);
        assertThat(count()).isEqualTo(before);
    }

    @Test
    void duplicateReferencesAreAtomicConflictsAndDoNotOverwriteExistingRecords() throws Exception {
        Map<?, ?> first = create();
        String reference = first.get("reference").toString();
        HttpResponse<String> duplicate = request("POST", PATH, payload("  " + reference + "  ", "MINOR"), token(WRITE));
        assertConflict(duplicate, "reference_conflict");
        assertThat(duplicate.body()).doesNotContain(reference);

        // Exact matching preserves case: no speculative case-folding for source identifiers.
        HttpResponse<String> upper = request("POST", PATH, payload(reference.toUpperCase(java.util.Locale.ROOT), "UNKNOWN"), token(WRITE));
        assertThat(upper.statusCode()).isEqualTo(201);
        Map<?, ?> second = create();
        Map<String, Object> update = payload(reference, "ADULT");
        update.put("version", 0);
        assertConflict(request("PUT", PATH + "/" + second.get("id"), update, token(WRITE)), "reference_conflict");
        assertThat(object(request("GET", PATH + "/" + first.get("id"), null, token(READ)))).isEqualTo(first);
        assertThat(object(request("GET", PATH + "/" + second.get("id"), null, token(READ)))).isEqualTo(second);
    }

    @Test
    void absentInvalidAndStaleReferencesHaveDistinctErrorsAndNoSilentRetry() throws Exception {
        Map<?, ?> created = create();
        String path = PATH + "/" + created.get("id");
        Map<String, Object> update = payload(created.get("reference").toString(), "MINOR");
        update.put("version", 0);
        assertProblem(request("GET", PATH + "/not-a-uuid", null, token(READ)), 400);
        assertProblem(request("GET", PATH + "/" + UUID.randomUUID(), null, token(READ)), 404);
        assertProblem(request("PUT", PATH + "/" + UUID.randomUUID(), update, token(WRITE)), 404);
        assertThat(request("PUT", path, update, token(WRITE)).statusCode()).isEqualTo(200);
        assertConflict(request("PUT", path, update, token(WRITE)), "concurrent_modification");
        assertThat(number(object(request("GET", path, null, token(READ))), "version")).isEqualTo(1);
        update.remove("version");
        assertProblem(request("PUT", path, update, token(WRITE)), 400);
        for (Object version : List.of(-1, 0.5, "1", 9223372036854775808.0)) {
            update.put("version", version);
            assertProblem(request("PUT", path, update, token(WRITE)), 400);
        }
        update.put("version", null);
        assertProblem(request("PUT", path, update, token(WRITE)), 400);
        update.put("version", 1);
        update.put("dateOfBirth", "DO_NOT_ECHO_PERSONAL_DATA");
        HttpResponse<String> rejected = request("PUT", path, update, token(WRITE));
        assertProblem(rejected, 400);
        assertThat(rejected.body()).doesNotContain("DO_NOT_ECHO_PERSONAL_DATA");
    }

    @Test
    void concurrentEditsOfTheSameVersionHaveOnlyOneWinner() throws Exception {
        Map<?, ?> created = create();
        String path = PATH + "/" + created.get("id");
        String bearer = token(WRITE);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> concurrentUpdate(path, created.get("reference").toString(), "MINOR", bearer, ready, start));
            var second = executor.submit(() -> concurrentUpdate(path, created.get("reference").toString(), "ADULT", bearer, ready, start));
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(200, 409);
        }
        Map<?, ?> saved = object(request("GET", path, null, token(READ)));
        assertThat(number(saved, "version")).isEqualTo(1);
        assertThat(saved.get("minorityStatus")).isIn("MINOR", "ADULT");
    }

    @Test
    void concurrentCreatesCannotPersistTheSameReferenceTwice() throws Exception {
        String reference = "Fictitious-unique-race-" + UUID.randomUUID();
        String bearer = token(WRITE);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> concurrentCreate(reference, bearer, ready, start));
            var second = executor.submit(() -> concurrentCreate(reference, bearer, ready, start));
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(201, 409);
        }
        try (Connection connection = appConnection(); var statement = connection.prepareStatement(
                "SELECT count(*) FROM auditions.heard_person WHERE reference = ?")) {
            statement.setString(1, reference);
            try (var rows = statement.executeQuery()) {
                assertThat(rows.next()).isTrue();
                assertThat(rows.getInt(1)).isEqualTo(1);
            }
        }
    }

    @Test
    void schemaRestrictsStatusesAndDoesNotContainCivilIdentityColumnsOrDeletePrivileges() throws Exception {
        try (Connection connection = appConnection(); var statement = connection.createStatement();
                var columns = statement.executeQuery("""
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'auditions' AND table_name = 'heard_person'
                """)) {
            List<String> names = new ArrayList<>();
            while (columns.next()) names.add(columns.getString(1));
            assertThat(names).containsExactlyInAnyOrder("id", "reference", "minority_status", "version");
        }
        try (Connection connection = appConnection(); var statement = connection.createStatement()) {
            for (String sql : List.of(
                    "DELETE FROM auditions.heard_person",
                    "ALTER TABLE auditions.heard_person ADD COLUMN unwanted text",
                    "INSERT INTO auditions.flyway_schema_history (installed_rank) VALUES (999)")) {
                assertThatThrownBy(() -> statement.execute(sql)).isInstanceOfSatisfying(SQLException.class,
                        failure -> assertThat(failure.getSQLState()).isEqualTo("42501"));
            }
        }
        try (Connection connection = appConnection(); var statement = connection.prepareStatement("""
                INSERT INTO auditions.heard_person (id, reference, minority_status, version) VALUES (?, ?, ?, ?)
                """)) {
            statement.setObject(1, UUID.randomUUID());
            statement.setString(2, "Fictitious-invalid-db-" + UUID.randomUUID());
            statement.setString(3, "CHILD");
            statement.setLong(4, 0);
            assertThatThrownBy(statement::executeUpdate).isInstanceOfSatisfying(SQLException.class,
                    failure -> assertThat(failure.getSQLState()).isEqualTo("23514"));
        }
    }

    @Test
    void additiveMigrationKeepsThePreviousHearingFixtureAndRunsOnlyOnce() throws Exception {
        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
        assertThat(flyway.migrate().migrationsExecuted).isZero();
        try (Connection connection = appConnection(); var statement = connection.prepareStatement(
                "SELECT label, active, version FROM auditions.hearing_type WHERE id = ?")) {
            statement.setObject(1, PostgresIntegrationFixture.PRE_V4_HEARING_ID);
            try (var rows = statement.executeQuery()) {
                assertThat(rows.next()).isTrue();
                assertThat(rows.getString(1)).isEqualTo("Fictitious-pre-V4");
                assertThat(rows.getBoolean(2)).isTrue();
                assertThat(rows.getLong(3)).isEqualTo(7);
            }
        }
        try (Connection connection = migratorConnection(); var statement = connection.createStatement();
                var rows = statement.executeQuery(
                        "SELECT count(*) FROM auditions.flyway_schema_history WHERE version = '5' AND success")) {
            assertThat(rows.next()).isTrue();
            assertThat(rows.getInt(1)).isEqualTo(1);
        }
    }

    private int concurrentUpdate(String path, String reference, String status, String bearer,
            CountDownLatch ready, CountDownLatch start) throws Exception {
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Concurrent test start was not released");
        Map<String, Object> value = payload(reference, status);
        value.put("version", 0);
        return request("PUT", path, value, bearer).statusCode();
    }

    private int concurrentCreate(String reference, String bearer, CountDownLatch ready, CountDownLatch start) throws Exception {
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Concurrent test start was not released");
        return request("POST", PATH, payload(reference, "UNKNOWN"), bearer).statusCode();
    }

    private Map<?, ?> create() throws Exception {
        HttpResponse<String> response = request("POST", PATH,
                payload("Fictitious-person-" + UUID.randomUUID(), "UNKNOWN"), token(BOTH));
        assertThat(response.statusCode()).isEqualTo(201);
        return object(response);
    }

    private static Map<String, Object> payload(String reference, String status) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("reference", reference);
        value.put("minorityStatus", status);
        return value;
    }

    private long count() throws SQLException {
        try (Connection connection = appConnection(); var statement = connection.createStatement();
                var rows = statement.executeQuery("SELECT count(*) FROM auditions.heard_person")) {
            rows.next();
            return rows.getLong(1);
        }
    }

    private void assertConflict(HttpResponse<String> response, String code) throws Exception {
        assertProblem(response, 409);
        assertThat(object(response).get("code")).isEqualTo(code);
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
            return new RSAKeyGenerator(2048).keyID("ephemeral-person-test").generate();
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
