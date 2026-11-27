-- Minimal planning reference and explicit status only: no civil identity or birth date.
CREATE TABLE auditions.heard_person (
    id uuid PRIMARY KEY,
    reference varchar(120) COLLATE "C" NOT NULL,
    minority_status varchar(7) NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT heard_person_reference CHECK (
        char_length(btrim(reference)) > 0 AND reference = btrim(reference)
    ),
    CONSTRAINT heard_person_reference_unique UNIQUE (reference),
    CONSTRAINT heard_person_minority_status CHECK (minority_status IN ('MINOR', 'ADULT', 'UNKNOWN')),
    CONSTRAINT heard_person_version CHECK (version >= 0)
);
GRANT SELECT, INSERT, UPDATE ON auditions.heard_person TO auditions_app;
