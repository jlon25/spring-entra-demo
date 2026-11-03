package io.github.jlon25.springentrademo.hearingtype;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
@Profile("postgres")
public class HearingTypeRepository {

    private static final String COLUMNS = "id, label, duration_minutes, pause_minutes, defender_required, version";

    private final JdbcClient jdbc;

    public HearingTypeRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<HearingType> findAll() {
        return jdbc.sql("SELECT " + COLUMNS + " FROM hearing_type ORDER BY label, id")
                .query(HearingType.class).list();
    }

    public Optional<HearingType> findById(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM hearing_type WHERE id = :id")
                .param("id", id).query(HearingType.class).optional();
    }

    public HearingType create(String label, int durationMinutes, int pauseMinutes, boolean defenderRequired) {
        return jdbc.sql("""
                INSERT INTO hearing_type (id, label, duration_minutes, pause_minutes, defender_required, version)
                VALUES (:id, :label, :duration, :pause, :defender, 0)
                """ + " RETURNING " + COLUMNS)
                .param("id", UUID.randomUUID()).param("label", label).param("duration", durationMinutes)
                .param("pause", pauseMinutes).param("defender", defenderRequired)
                .query(HearingType.class).single();
    }

    public Optional<HearingType> update(UUID id, String label, int durationMinutes, int pauseMinutes,
            boolean defenderRequired, long version) {
        // PostgreSQL rechecks this predicate after a concurrent writer releases its row lock.
        return jdbc.sql("""
                UPDATE hearing_type
                SET label = :label, duration_minutes = :duration, pause_minutes = :pause,
                    defender_required = :defender, version = version + 1
                WHERE id = :id AND version = :version
                """ + " RETURNING " + COLUMNS)
                .param("id", id).param("label", label).param("duration", durationMinutes)
                .param("pause", pauseMinutes).param("defender", defenderRequired).param("version", version)
                .query(HearingType.class).optional();
    }
}
