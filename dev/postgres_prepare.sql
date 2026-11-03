-- Explicit preparation for new AND existing development volumes.
-- Re-running this file updates the fixed roles' passwords from the container env.
-- Run through postgres_prepare.sh; do not enable psql echo or SQL tracing.
\set ON_ERROR_STOP on
\set ECHO none
\set QUIET on
\set VERBOSITY terse

-- Suppress SQL logging only for this bootstrap session before handling secrets.
-- The bootstrap administrator must be a PostgreSQL superuser.
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET log_min_duration_statement = -1;
SET log_min_duration_sample = -1;
SET log_transaction_sample_rate = 0;
SET password_encryption = 'scram-sha-256';

\set app_password ''
\set migration_password ''
\getenv app_password APP_DB_PASSWORD
\getenv migration_password DB_MIGRATION_PASSWORD
SELECT length(:'app_password') > 0 AND length(:'migration_password') > 0 AS passwords_present \gset
\if :passwords_present
\else
  \echo 'Preparation refused: APP_DB_PASSWORD and DB_MIGRATION_PASSWORD must be nonempty.'
  \quit 3
\endif

BEGIN;

SELECT 'CREATE ROLE auditions_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auditions_migrator') \gexec
SELECT 'CREATE ROLE auditions_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auditions_app') \gexec

-- Refuse to take over unexpectedly privileged/shared roles or an unknown schema.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname IN ('auditions_migrator', 'auditions_app')
          AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication
               OR rolbypassrls OR NOT rolcanlogin)
    ) OR EXISTS (
        SELECT 1 FROM pg_auth_members m
        JOIN pg_roles r ON r.oid = m.member OR r.oid = m.roleid
        WHERE r.rolname IN ('auditions_migrator', 'auditions_app')
    ) THEN
        RAISE EXCEPTION 'Preparation refused: application roles have unexpected attributes or memberships';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner
        WHERE n.nspname = 'auditions' AND r.rolname <> 'auditions_migrator'
    ) THEN
        RAISE EXCEPTION 'Preparation refused: auditions schema has an unexpected owner';
    END IF;
END;
$$;

SELECT format('ALTER ROLE auditions_migrator PASSWORD %L', :'migration_password') \gexec
SELECT format('ALTER ROLE auditions_app PASSWORD %L', :'app_password') \gexec
\unset app_password
\unset migration_password

SELECT format('GRANT CONNECT ON DATABASE %I TO auditions_migrator, auditions_app', current_database()) \gexec
CREATE SCHEMA IF NOT EXISTS auditions AUTHORIZATION auditions_migrator;
REVOKE ALL ON SCHEMA auditions FROM PUBLIC;
REVOKE ALL ON SCHEMA auditions FROM auditions_app;
GRANT USAGE ON SCHEMA auditions TO auditions_app;
-- Table grants belong to each versioned migration; never grant app access to
-- every future table, which would include Flyway's schema-history table.
COMMIT;
\echo 'PostgreSQL application roles and schema prepared; existing data preserved.'
