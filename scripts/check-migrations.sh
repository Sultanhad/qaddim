#!/bin/sh
# Replays every migration, in order, into a throwaway local database.
#
# Supabase's own schemas (auth, storage) are stubbed just enough for the SQL to run, so a
# typo or a broken `create or replace` is caught here instead of in the owner's SQL editor.
# The spec asks for migrations to be tried on staging before production; this is the local
# stand-in until a staging project exists.
#
#   sh scripts/check-migrations.sh            # uses Postgres.app on localhost:5432
set -e
PSQL=${PSQL:-/Applications/Postgres.app/Contents/Versions/14/bin/psql}
DB="qaddim_migcheck_$$"
HERE=$(cd "$(dirname "$0")/.." && pwd)

"$PSQL" -q -d postgres -c "create database $DB" >/dev/null
trap '"$PSQL" -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT

"$PSQL" -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL' >/dev/null
create extension if not exists pgcrypto;
-- auth: a users table and uid() that reads a session setting the test can set
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
-- roles are cluster-wide, so they outlive the throwaway database
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
-- storage: what the policies reference
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
alter table storage.objects enable row level security;
SQL

ok=0
for f in "$HERE"/supabase/migrations/*.sql; do
  # pg_cron and pg_net are Supabase-hosted extensions; nothing in the migrations calls them,
  # only installs them, so the install lines are the one thing stubbed out here.
  if sed -E 's/^create extension if not exists (pg_cron|pg_net);/select 1; -- &/' "$f" \
     | "$PSQL" -q -v ON_ERROR_STOP=1 -d "$DB" >/tmp/migcheck.out 2>&1; then
    echo "  ✓ $(basename "$f")"; ok=$((ok+1))
  else
    echo "  ✗ $(basename "$f")"; sed 's/^/      /' /tmp/migcheck.out | head -12; exit 1
  fi
done
echo "$ok migration(s) apply cleanly in order"

# What the migrations promise, asked of the database they just built: each file in
# supabase/tests/sql raises an exception on the first promise that does not hold.
for t in "$HERE"/supabase/tests/sql/*.sql; do
  [ -f "$t" ] || continue
  if "$PSQL" -q -v ON_ERROR_STOP=1 -d "$DB" -f "$t" >/tmp/migcheck.out 2>&1; then
    echo "  ✓ $(basename "$t") holds"
  else
    echo "  ✗ $(basename "$t")"; grep -E "ERROR|—" /tmp/migcheck.out | head -6 | sed 's/^/      /'; exit 1
  fi
done

# schema.sql exists so a new project can be stood up in one paste. It drifted three migrations
# behind, so anyone following the README got a database the app 400s against. It is now
# generated from the chain, and this check fails when the two disagree.
GEN="$HERE/supabase/schema.sql"
TMP=$(mktemp)
{
  echo "-- قدّم — database schema."
  echo "--"
  echo "-- GENERATED: the migrations in supabase/migrations are the source of truth."
  echo "-- Regenerate with: sh scripts/check-migrations.sh --write"
  echo "-- Paste this into a brand-new project; an existing one takes the migrations instead."
  echo
  for f in "$HERE"/supabase/migrations/*.sql; do
    echo "-- ───────────────────────────────────────────── $(basename "$f") ──"
    cat "$f"
    echo
  done
} > "$TMP"

if [ "$1" = "--write" ]; then
  cp "$TMP" "$GEN"; echo "  schema.sql regenerated from $ok migration(s)"
elif ! diff -q "$TMP" "$GEN" >/dev/null 2>&1; then
  echo "  ✗ schema.sql is behind the migrations — run: sh scripts/check-migrations.sh --write"
  rm -f "$TMP"; exit 1
else
  echo "  schema.sql matches the migrations"
fi
rm -f "$TMP"
