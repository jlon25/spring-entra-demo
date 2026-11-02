#!/usr/bin/env python3
"""Verify PostgreSQL persistence and restore in an explicitly disposable project.

Never run against the normal development Compose project. The test recreates the
postgres container and creates/drops only its own randomly named test databases.
"""

import argparse
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys


ROOT = Path(__file__).resolve().parent.parent
PSQL = 'exec psql -X --set=ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" --tuples-only --no-align'
DUMP = 'exec pg_dump -U "$POSTGRES_USER" -d "$1" --format=custom'
RESTORE = 'exec pg_restore -U "$POSTGRES_USER" -d "$1" --exit-on-error --no-owner --no-privileges'


def compose(arguments, *, data=None, label="Compose command", timeout=180):
    command = ["docker", "compose", "--project-directory", str(ROOT),
               "-f", str(ROOT / "compose.yaml"),
               "-f", str(ROOT / "compose.postgres.yaml"), *arguments]
    try:
        result = subprocess.run(command, input=data, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, check=False, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError(label + " could not complete") from None
    if result.returncode:
        # Do not echo command environments, database contents, archives or passwords.
        raise RuntimeError(label + " failed (exit " + str(result.returncode) + ")")
    return result.stdout


def psql(database, sql, *, label="PostgreSQL check"):
    return compose(["exec", "-T", "postgres", "sh", "-c", PSQL, "sh", database],
                   data=sql.encode("utf-8"), label=label).decode("utf-8").strip()


def create_database(database):
    psql("postgres", 'CREATE DATABASE "' + database + '";', label="Create isolated test database")


def drop_database(database):
    psql("postgres", 'DROP DATABASE "' + database + '";', label="Remove isolated test database")


def verify_foundation():
    # Generated identifiers are lowercase ASCII and are not supplied by a caller.
    suffix = secrets.token_hex(8)
    source = "pg_smoke_source_" + suffix
    restored = "pg_smoke_restore_" + suffix
    created = []
    failure = None
    try:
        version = psql("postgres", "SHOW server_version;", label="Read PostgreSQL version")
        tcp_check = compose(["exec", "-T", "postgres", "sh", "-c",
                             'PGPASSWORD="$POSTGRES_PASSWORD" exec psql --no-password '
                             '-h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" '
                             '--set=ON_ERROR_STOP=1 --tuples-only --no-align --command="SELECT 1;"'],
                            label="Authenticate over PostgreSQL TCP")
        if tcp_check.strip() != b"1":
            raise RuntimeError("PostgreSQL TCP authentication check returned an unexpected value")
        compose(["exec", "-T", "postgres", "sh", "-c",
                 'if PGPASSWORD="${POSTGRES_PASSWORD}-invalid" psql --no-password '
                 '-h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" '
                 '--set=ON_ERROR_STOP=1 --command="SELECT 1;" >/dev/null 2>&1; '
                 'then exit 1; fi'], label="Reject incorrect PostgreSQL TCP password")
        create_database(source)
        created.append(source)
        psql(source, "CREATE TABLE foundation_probe (id integer PRIMARY KEY, marker text NOT NULL);"
             "INSERT INTO foundation_probe VALUES (1, 'fictitious-persistence-probe');",
             label="Write fictitious persistence probe")
        archive = compose(["exec", "-T", "postgres", "sh", "-c", DUMP, "sh", source],
                          label="Dump isolated test database")
        if not archive.startswith(b"PGDMP"):
            raise RuntimeError("PostgreSQL dump is not a custom-format archive")
        compose(["up", "--detach", "--no-deps", "--force-recreate", "--wait",
                 "--wait-timeout", "120", "postgres"],
                label="Recreate isolated PostgreSQL container", timeout=180)
        marker = psql(source, "SELECT marker FROM foundation_probe WHERE id = 1;",
                      label="Read probe after container recreation")
        if marker != "fictitious-persistence-probe":
            raise RuntimeError("Persistence probe changed after container recreation")
        create_database(restored)
        created.append(restored)
        compose(["exec", "-T", "postgres", "sh", "-c", RESTORE, "sh", restored],
                data=archive, label="Restore isolated test database")
        marker = psql(restored, "SELECT marker FROM foundation_probe WHERE id = 1;",
                      label="Read restored probe")
        if marker != "fictitious-persistence-probe":
            raise RuntimeError("Restored persistence probe does not match")
    except (RuntimeError, UnicodeError) as error:
        failure = error
    finally:
        for database in reversed(created):
            try:
                drop_database(database)
            except RuntimeError:
                # Cleanup is scoped to the test names; never drop the configured database.
                print("Could not remove an isolated smoke-test database; inspect the disposable project.",
                      file=sys.stderr)
                if failure is None:
                    failure = RuntimeError("Isolated test database cleanup failed")
    if failure is not None:
        raise RuntimeError(str(failure)) from None
    print("PostgreSQL smoke check passed: server " + version
          + ", TCP password authentication, volume persistence and custom-format restore")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow-test-databases", action="store_true",
                        help="allow creating test databases and recreating postgres in a disposable project")
    arguments = parser.parse_args()
    project = os.environ.get("COMPOSE_PROJECT_NAME", "")
    if (not arguments.allow_test_databases
            or re.fullmatch(r"pg-smoke-[a-z0-9][a-z0-9_-]*", project) is None):
        print("Refusing PostgreSQL smoke mutations: use --allow-test-databases and an explicitly disposable "
              "COMPOSE_PROJECT_NAME beginning with pg-smoke-.", file=sys.stderr)
        return 2
    try:
        verify_foundation()
    except RuntimeError as error:
        print("PostgreSQL smoke check failed: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
