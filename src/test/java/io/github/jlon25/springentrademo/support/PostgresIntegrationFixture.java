package io.github.jlon25.springentrademo.support;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.UUID;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;

/** One isolated database preparation per test JVM, shared by the API test classes. */
public final class PostgresIntegrationFixture {

    public static final UUID PRE_V4_HEARING_ID = UUID.randomUUID();
    private static boolean prepared;

    private PostgresIntegrationFixture() {
    }

    public static synchronized void prepareVersionThree() {
        if (prepared) return;
        // Never clean, downgrade or accept a pre-existing migrated development database.
        Flyway previous = Flyway.configure()
                .dataSource(required("TEST_DB_URL"), "auditions_migrator", required("TEST_DB_MIGRATION_PASSWORD"))
                .schemas("auditions").defaultSchema("auditions").createSchemas(false)
                .cleanDisabled(true).target("3").load();
        var current = previous.info().current();
        if (current != null && current.getVersion().compareTo(MigrationVersion.fromVersion("3")) > 0) {
            throw new IllegalStateException("Use a fresh isolated database for API migration tests.");
        }
        previous.migrate();
        try (Connection connection = DriverManager.getConnection(required("TEST_DB_URL"),
                "auditions_migrator", required("TEST_DB_MIGRATION_PASSWORD"));
                var statement = connection.prepareStatement("""
                INSERT INTO auditions.hearing_type
                    (id, label, duration_minutes, pause_minutes, defender_required, version)
                VALUES (?, 'Fictitious-pre-V4', 90, 0, true, 7)
                """)) {
            statement.setObject(1, PRE_V4_HEARING_ID);
            statement.executeUpdate();
            prepared = true;
        }
        catch (SQLException failure) {
            throw new IllegalStateException("Cannot prepare the isolated migration fixture.", failure);
        }
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing isolated integration-test setting: " + name);
        }
        return value;
    }
}
