package io.github.jlon25.springentrademo.heardperson;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
@Profile("postgres")
public class HeardPersonRepository {

    private static final String COLUMNS = "id, reference, minority_status, version";
    private static final RowMapper<HeardPerson> ROW = (row, index) -> new HeardPerson(
            row.getObject("id", UUID.class), row.getString("reference"),
            MinorityStatus.valueOf(row.getString("minority_status")), row.getLong("version"));

    private final JdbcClient jdbc;

    public HeardPersonRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public List<HeardPerson> findAll() {
        return jdbc.sql("SELECT " + COLUMNS + " FROM heard_person ORDER BY reference, id")
                .query(ROW).list();
    }

    public Optional<HeardPerson> findById(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM heard_person WHERE id = :id")
                .param("id", id).query(ROW).optional();
    }

    public HeardPerson create(String reference, MinorityStatus minorityStatus) {
        return jdbc.sql("""
                INSERT INTO heard_person (id, reference, minority_status, version)
                VALUES (:id, :reference, :minority, 0)
                """ + " RETURNING " + COLUMNS)
                .param("id", UUID.randomUUID()).param("reference", reference)
                .param("minority", minorityStatus.name()).query(ROW).single();
    }

    public Optional<HeardPerson> update(UUID id, String reference, MinorityStatus minorityStatus, long version) {
        // One predicate protects both the reference and status from lost updates.
        return jdbc.sql("""
                UPDATE heard_person
                SET reference = :reference, minority_status = :minority, version = version + 1
                WHERE id = :id AND version = :version
                """ + " RETURNING " + COLUMNS)
                .param("id", id).param("reference", reference).param("minority", minorityStatus.name())
                .param("version", version).query(ROW).optional();
    }
}
