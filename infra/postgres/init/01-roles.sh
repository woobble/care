#!/usr/bin/env bash
set -euo pipefail

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set ON_ERROR_STOP=1 \
  --set care_app_password="$CARE_APP_PASSWORD" \
  --set care_worker_password="$CARE_WORKER_PASSWORD" <<'SQL'
CREATE ROLE care_app LOGIN PASSWORD :'care_app_password';
CREATE ROLE care_worker LOGIN PASSWORD :'care_worker_password';
GRANT CONNECT ON DATABASE care TO care_app, care_worker;
CREATE DATABASE authentik OWNER care_owner;
SQL
