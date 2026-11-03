#!/usr/bin/env bash
# Prepare only the application's fixed roles and schema; preserve existing data.
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
docker compose --project-directory "$project_root" \
  -f "$project_root/compose.yaml" -f "$project_root/compose.postgres.yaml" \
  exec -T postgres sh -c \
  'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < "$project_root/dev/postgres_prepare.sql"
