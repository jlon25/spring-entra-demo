#!/usr/bin/env bash
# Back up one database, not global roles or server configuration.
set -euo pipefail
umask 077

if [[ $# -ne 1 || -z "$1" ]]; then
    printf 'Usage: bash dev/postgres_backup.sh backups/name.dump\n' >&2
    exit 2
fi

script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
project_directory=$(cd -- "$script_directory/.." && pwd)
destination=$1
if [[ -e "$destination" || -L "$destination" ]]; then
    printf 'Backup destination already exists; refusing to overwrite it.\n' >&2
    exit 2
fi
backup_directory=$(dirname -- "$destination")
mkdir -p -- "$backup_directory"
temporary=$(mktemp "$backup_directory/.postgres-backup.XXXXXXXX")
cleanup() {
    rm -f -- "$temporary"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker compose --project-directory "$project_directory" \
    -f "$project_directory/compose.yaml" \
    -f "$project_directory/compose.postgres.yaml" \
    exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
    > "$temporary"

# Hard-link publication is atomic and fails if another process created the target.
# -T also prevents interpreting an existing directory as a destination directory.
ln -T -- "$temporary" "$destination"
printf 'Database backup created: %s\n' "$destination"
