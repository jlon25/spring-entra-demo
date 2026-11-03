-- Preserve V1 checksums for databases that have already applied it.
ALTER TABLE auditions.hearing_type DROP CONSTRAINT hearing_type_pause;
ALTER TABLE auditions.hearing_type
    ADD CONSTRAINT hearing_type_pause CHECK (pause_minutes >= 0);
