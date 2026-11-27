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
import org.flywaydb.core.api.MigrationVersion;
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

    private static final UUID PRE_V4_ID = UUID.randomUUID();
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
        prepareVersionThreeFixture();
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
        assertThat(resource.get("active")).isEqualTo(true);
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
    void zeroPauseIsAcceptedOnCreationAndUpdateAndPersisted() throws Exception {
        Map<String, Object> payload = validPayload("Fictitious-zero-pause-" + UUID.randomUUID());
        payload.put("pauseMinutes", 0);
        HttpResponse<String> response = request("POST", PATH, payload, token(WRITE));
        assertThat(response.statusCode()).isEqualTo(201);
        Map<?, ?> created = object(response);
        String path = PATH + "/" + created.get("id");
        assertThat(number(created, "pauseMinutes")).isZero();
        payload.put("version", 0);
        assertThat(request("PUT", path, payload, token(WRITE)).statusCode()).isEqualTo(200);
        assertThat(number(object(request("GET", path, null, token(READ))), "pauseMinutes")).isZero();
        try (Connection connection = appConnection();
                var statement = connection.prepareStatement(
                        "SELECT pause_minutes FROM auditions.hearing_type WHERE id = ?")) {
            statement.setObject(1, UUID.fromString(created.get("id").toString()));
            try (var rows = statement.executeQuery()) {
                assertThat(rows.next()).isTrue();
                assertThat(rows.getInt(1)).isZero();
            }
        }
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
        assertThat(request("DELETE", PATH + "/" + id + "?version=1", null, token(READ)).statusCode()).isEqualTo(403);
        assertThat(request("PATCH", PATH + "/" + id, null, token(BOTH)).statusCode()).isEqualTo(403);
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
        for (String unknown : List.of("id", "version", "active", "unknownField")) {
            Map<String, Object> payload = validPayload("Fictitious-validation");
            payload.put(unknown, unknown.equals("id") ? UUID.randomUUID().toString() : 0);
            invalid.add(payload);
        }
        for (String field : List.of("durationMinutes", "pauseMinutes")) {
            for (Object value : field.equals("durationMinutes")
                    ? List.of(0, -1, 1.5, 2147483648L) : List.of(-1, 1.5, 2147483648L)) {
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
        payload.put("pauseMinutes", -1);
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
    void applicationAccountCannotChangeSchemaOrWriteFlywayHistory() throws Exception {
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
                    "UPDATE auditions.flyway_schema_history SET success = false WHERE false")) {
                assertThatThrownBy(() -> statement.execute(sql)).isInstanceOfSatisfying(SQLException.class,
                        error -> assertThat(error.getSQLState()).isEqualTo("42501"));
            }
        }
    }

    @Test
    void deleteRequiresWriteScopeAndRemovesThePersistedResource() throws Exception {
        Map<?, ?> created = create();
        String id = created.get("id").toString();
        String path = PATH + "/" + id;
        String deletion = path + "?version=0";
        assertThat(request("DELETE", deletion, null, null).statusCode()).isEqualTo(401);
        assertThat(request("DELETE", deletion, null, "not-a-jwt").statusCode()).isEqualTo(401);
        assertThat(request("DELETE", deletion, null, token(READ)).statusCode()).isEqualTo(403);
        assertThat(request("DELETE", deletion, null, token("api.read")).statusCode()).isEqualTo(403);
        assertThat(object(request("GET", path, null, token(READ)))).isEqualTo(created);

        HttpResponse<String> deleted = request("DELETE", deletion, null, token(WRITE));
        assertThat(deleted.statusCode()).isEqualTo(204);
        assertThat(deleted.body()).isEmpty();
        assertProblem(request("GET", path, null, token(READ)), 404);
        assertProblem(request("DELETE", deletion, null, token(WRITE)), 404);
        HttpResponse<String> listed = request("GET", PATH, null, token(READ));
        assertThat(listed.statusCode()).isEqualTo(200);
        List<?> resources = JSON.readValue(listed.body(), List.class);
        assertThat(resources.stream().filter(Map.class::isInstance)
                .map(Map.class::cast).anyMatch(item -> id.equals(item.get("id")))).isFalse();
        try (Connection connection = appConnection(); var statement = connection.prepareStatement(
                "SELECT count(*) FROM auditions.hearing_type WHERE id = ?")) {
            statement.setObject(1, UUID.fromString(id));
            try (var rows = statement.executeQuery()) {
                assertThat(rows.next()).isTrue();
                assertThat(rows.getInt(1)).isZero();
            }
        }
    }

    @Test
    void deleteWithAnObsoleteVersionDoesNotRemoveTheNewerResource() throws Exception {
        Map<?, ?> created = create();
        String path = PATH + "/" + created.get("id");
        Map<String, Object> update = validPayload("Fictitious-updated-before-delete");
        update.put("version", 0);
        HttpResponse<String> updated = request("PUT", path, update, token(WRITE));
        assertThat(updated.statusCode()).isEqualTo(200);
        assertProblem(request("DELETE", path + "?version=0", null, token(WRITE)), 409);
        assertThat(object(request("GET", path, null, token(READ)))).isEqualTo(object(updated));
        assertThat(request("DELETE", path + "?version=1", null, token(WRITE)).statusCode()).isEqualTo(204);
        assertProblem(request("GET", path, null, token(READ)), 404);
    }

    @Test
    void deleteRequiresANonnegativeIntegerVersionAndAValidIdentifier() throws Exception {
        Map<?, ?> created = create();
        String path = PATH + "/" + created.get("id");
        for (String suffix : List.of("", "?version=", "?version=-1", "?version=0.5",
                "?version=null", "?version=invalid", "?version=9223372036854775808")) {
            assertProblem(request("DELETE", path + suffix, null, token(WRITE)), 400);
        }
        assertProblem(request("DELETE", PATH + "/not-a-uuid?version=0", null, token(WRITE)), 400);
        assertThat(object(request("GET", path, null, token(READ)))).isEqualTo(created);
    }

    @Test
    void concurrentDeleteAndUpdateCannotBothApplyToTheSameVersion() throws Exception {
        Map<?, ?> created = create();
        String path = PATH + "/" + created.get("id");
        Map<String, Object> update = validPayload("Fictitious-delete-update-race");
        update.put("version", 0);
        String bearer = token(WRITE);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var deletion = executor.submit(() -> {
                ready.countDown();
                if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Race did not start");
                return request("DELETE", path + "?version=0", null, bearer).statusCode();
            });
            var modification = executor.submit(() -> {
                ready.countDown();
                if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Race did not start");
                return request("PUT", path, update, bearer).statusCode();
            });
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            int deleteStatus = deletion.get(20, TimeUnit.SECONDS);
            int updateStatus = modification.get(20, TimeUnit.SECONDS);
            assertThat((deleteStatus == 204 && updateStatus == 404)
                    || (deleteStatus == 409 && updateStatus == 200)).isTrue();
            if (deleteStatus == 204) {
                assertProblem(request("GET", path, null, token(READ)), 404);
            }
            else {
                assertThat(number(object(request("GET", path, null, token(READ))), "version")).isEqualTo(1);
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
                        "SELECT count(*) FROM auditions.flyway_schema_history WHERE version IN ('1', '2', '3', '4') AND success")) {
            assertThat(rows.next()).isTrue();
            assertThat(rows.getInt(1)).isEqualTo(4);
        }
    }


    @Test
    void versionFourPreservesPreexistingTypesAsActiveWithoutChangingTheirVersion() throws Exception {
        Map<?, ?> existing = object(request("GET", PATH + "/" + PRE_V4_ID, null, token(READ)));
        assertThat(existing.get("label")).isEqualTo("Fictitious-pre-V4");
        assertThat(existing.get("active")).isEqualTo(true);
        assertThat(number(existing, "version")).isEqualTo(7);
        assertThat(number(existing, "durationMinutes")).isEqualTo(90);
        assertThat(number(existing, "pauseMinutes")).isZero();
        try (Connection connection = appConnection(); var statement = connection.prepareStatement(
                "UPDATE auditions.hearing_type SET active = NULL WHERE id = ?")) {
            statement.setObject(1, PRE_V4_ID);
            assertThatThrownBy(statement::executeUpdate).isInstanceOfSatisfying(SQLException.class,
                    error -> assertThat(error.getSQLState()).isEqualTo("23502"));
        }
    }

    @Test
    void statusMovesTypesBetweenFilteredListsAndParameterEditsPreserveTheStatus() throws Exception {
        Map<?, ?> created = create();
        String path = PATH + "/" + created.get("id");
        String id = created.get("id").toString();
        assertThat(created.get("active")).isEqualTo(true);
        assertThat(listContains(PATH, id)).isTrue();
        assertThat(listContains(PATH + "?active=true", id)).isTrue();
        assertThat(listContains(PATH + "?active=false", id)).isFalse();

        HttpResponse<String> disabled = request("PUT", path + "/status",
                Map.of("active", false, "version", 0), token(WRITE));
        assertThat(disabled.statusCode()).isEqualTo(200);
        Map<?, ?> inactive = object(disabled);
        assertThat(inactive.get("active")).isEqualTo(false);
        assertThat(number(inactive, "version")).isEqualTo(1);
        assertThat(inactive.get("label")).isEqualTo(created.get("label"));
        assertThat(number(inactive, "durationMinutes")).isEqualTo(number(created, "durationMinutes"));
        assertThat(number(inactive, "pauseMinutes")).isEqualTo(number(created, "pauseMinutes"));
        assertThat(inactive.get("defenderRequired")).isEqualTo(created.get("defenderRequired"));
        assertThat(listContains(PATH, id)).isFalse();
        assertThat(listContains(PATH + "?active=false", id)).isTrue();
        assertThat(object(request("GET", path, null, token(READ)))).isEqualTo(inactive);

        Map<String, Object> edit = validPayload("Fictitious-edited-inactive");
        edit.put("version", 1);
        assertThat(request("PUT", path, edit, token(WRITE)).statusCode()).isEqualTo(200);
        Map<?, ?> edited = object(request("GET", path, null, token(READ)));
        assertThat(edited.get("active")).isEqualTo(false);
        assertThat(number(edited, "version")).isEqualTo(2);
        assertProblem(request("PUT", path + "/status", Map.of("active", true, "version", 1), token(WRITE)), 409);

        HttpResponse<String> enabled = request("PUT", path + "/status",
                Map.of("active", true, "version", 2), token(WRITE));
        assertThat(enabled.statusCode()).isEqualTo(200);
        assertThat(object(enabled).get("active")).isEqualTo(true);
        assertThat(number(object(enabled), "version")).isEqualTo(3);
        assertThat(listContains(PATH, id)).isTrue();
        assertThat(listContains(PATH + "?active=false", id)).isFalse();

        // An explicit same-state write still consumes the supplied version.
        HttpResponse<String> repeatedState = request("PUT", path + "/status",
                Map.of("active", true, "version", 3), token(WRITE));
        assertThat(repeatedState.statusCode()).isEqualTo(200);
        assertThat(number(object(repeatedState), "version")).isEqualTo(4);
        assertThat(request("DELETE", path + "?version=4", null, token(WRITE)).statusCode()).isEqualTo(204);
    }

    @Test
    void statusRequiresWriteScopeAndInactiveListsRequireReadScope() throws Exception {
        Map<?, ?> created = create();
        String path = PATH + "/" + created.get("id");
        Map<String, Object> payload = Map.of("active", false, "version", 0);
        assertThat(request("PUT", path + "/status", payload, null).statusCode()).isEqualTo(401);
        assertThat(request("PUT", path + "/status", payload, "not-a-jwt").statusCode()).isEqualTo(401);
        for (String scope : List.of(READ, "api.read")) {
            assertThat(request("PUT", path + "/status", payload, token(scope)).statusCode()).isEqualTo(403);
        }
        assertThat(request("GET", PATH + "?active=false", null, token(WRITE)).statusCode()).isEqualTo(403);
        assertThat(request("GET", PATH + "?active=false", null, token(READ)).statusCode()).isEqualTo(200);
        assertThat(object(request("GET", path, null, token(READ)))).isEqualTo(created);
        assertThat(request("PUT", path + "/status", payload, token(WRITE)).statusCode()).isEqualTo(200);
        // An inactive record remains removable under the existing DELETE contract.
        assertThat(request("DELETE", path + "?version=1", null, token(WRITE)).statusCode()).isEqualTo(204);
    }

    @Test
    void invalidStatusRequestsAndUnknownReferencesDoNotModifyTheType() throws Exception {
        Map<?, ?> created = create();
        String path = PATH + "/" + created.get("id");
        List<Map<String, Object>> invalid = new ArrayList<>();
        invalid.add(Map.of());
        invalid.add(Map.of("active", false));
        invalid.add(Map.of("version", 0));
        for (Object active : List.of("false", 0, 1)) {
            invalid.add(Map.of("active", active, "version", 0));
        }
        for (Object version : List.of(-1, 0.5, "0", "invalid")) {
            invalid.add(Map.of("active", false, "version", version));
        }
        for (String field : List.of("active", "version")) {
            Map<String, Object> nullField = new LinkedHashMap<>(Map.of("active", false, "version", 0));
            nullField.put(field, null);
            invalid.add(nullField);
        }
        invalid.add(Map.of("active", false, "version", 0, "label", "Unexpected"));
        for (Map<String, Object> payload : invalid) {
            assertProblem(request("PUT", path + "/status", payload, token(WRITE)), 400);
        }
        assertProblem(rawRequest("PUT", path + "/status", "{", token(WRITE)), 400);
        assertProblem(request("PUT", PATH + "/not-a-uuid/status",
                Map.of("active", false, "version", 0), token(WRITE)), 400);
        assertProblem(request("PUT", PATH + "/" + UUID.randomUUID() + "/status",
                Map.of("active", false, "version", 0), token(WRITE)), 404);
        assertProblem(request("GET", PATH + "?active=invalid", null, token(READ)), 400);
        assertThat(object(request("GET", path, null, token(READ)))).isEqualTo(created);
        Map<String, Object> edit = validPayload("Fictitious-no-status-in-parameter-edit");
        edit.put("version", 0);
        edit.put("active", false);
        assertProblem(request("PUT", path, edit, token(WRITE)), 400);
        assertThat(object(request("GET", path, null, token(READ)))).isEqualTo(created);
    }

    @Test
    void concurrentStatusAndParameterUpdatesCannotBothConsumeTheSameVersion() throws Exception {
        Map<?, ?> created = create();
        String path = PATH + "/" + created.get("id");
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        String bearer = token(WRITE);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var status = executor.submit(() -> {
                ready.countDown();
                if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Race did not start");
                return request("PUT", path + "/status", Map.of("active", false, "version", 0), bearer).statusCode();
            });
            var edit = executor.submit(() -> concurrentUpdate(path, 61, bearer, ready, start));
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(List.of(status.get(20, TimeUnit.SECONDS), edit.get(20, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(200, 409);
        }
        Map<?, ?> current = object(request("GET", path, null, token(READ)));
        assertThat(number(current, "version")).isEqualTo(1);
        if (Boolean.FALSE.equals(current.get("active"))) {
            assertThat(number(current, "durationMinutes")).isEqualTo(60);
        }
        else {
            assertThat(number(current, "durationMinutes")).isEqualTo(61);
        }
    }

    private boolean listContains(String path, String id) throws Exception {
        HttpResponse<String> response = request("GET", path, null, token(READ));
        assertThat(response.statusCode()).isEqualTo(200);
        List<?> rows = JSON.readValue(response.body(), List.class);
        return rows.stream().filter(Map.class::isInstance).map(Map.class::cast)
                .anyMatch(row -> id.equals(row.get("id")));
    }

    private static void prepareVersionThreeFixture() {
        // This class requires the disposable CI/test DB. Never downgrade or reset an existing schema.
        Flyway previous = Flyway.configure()
                .dataSource(required("TEST_DB_URL"), "auditions_migrator", required("TEST_DB_MIGRATION_PASSWORD"))
                .schemas("auditions").defaultSchema("auditions").createSchemas(false)
                .cleanDisabled(true).target("3").load();
        var current = previous.info().current();
        if (current != null && current.getVersion().compareTo(MigrationVersion.fromVersion("3")) > 0) {
            throw new IllegalStateException("Use a fresh isolated database for the V3-to-V4 upgrade test.");
        }
        previous.migrate();
        try (Connection connection = migratorConnection(); var statement = connection.prepareStatement("""
                INSERT INTO auditions.hearing_type
                    (id, label, duration_minutes, pause_minutes, defender_required, version)
                VALUES (?, 'Fictitious-pre-V4', 90, 0, true, 7)
                """)) {
            statement.setObject(1, PRE_V4_ID);
            statement.executeUpdate();
        }
        catch (SQLException error) {
            throw new IllegalStateException("Cannot prepare the isolated pre-V4 fixture.", error);
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
