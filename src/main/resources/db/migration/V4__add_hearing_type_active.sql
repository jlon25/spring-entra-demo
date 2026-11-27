-- Preserve existing types and their parameters; new and existing rows start active.
ALTER TABLE hearing_type ADD COLUMN active boolean NOT NULL DEFAULT true;
