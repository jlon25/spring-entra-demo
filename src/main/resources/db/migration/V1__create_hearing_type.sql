-- Additive first business schema. No fictional business defaults or seed rows.
CREATE TABLE auditions.hearing_type (
    id uuid PRIMARY KEY,
    label varchar(120) NOT NULL,
    duration_minutes integer NOT NULL,
    pause_minutes integer NOT NULL,
    defender_required boolean NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT hearing_type_label CHECK (char_length(btrim(label)) > 0 AND label = btrim(label)),
    CONSTRAINT hearing_type_duration CHECK (duration_minutes > 0),
    CONSTRAINT hearing_type_pause CHECK (pause_minutes > 0),
    CONSTRAINT hearing_type_version CHECK (version >= 0)
);
GRANT SELECT, INSERT, UPDATE ON auditions.hearing_type TO auditions_app;
