#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ -n "${COMPOSE_PROJECT_NAME:-}" && "${COMPOSE_PROJECT_NAME}" != "care-platform-dev" ]]; then
  echo "Reset only targets the dedicated care-platform-dev project; clear COMPOSE_PROJECT_NAME first." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to reset the local application." >&2
  exit 1
fi

docker compose --project-name care-platform-dev -f compose.yaml config --quiet

cat <<'EOF'
This resets the dedicated care-platform-dev Compose project. It deletes its containers and volumes,
including PostgreSQL (application and Authentik data), Redis, SeaweedFS files,
Prometheus metrics, and Grafana state. Source files, .env, dependencies, and
Docker images are kept.

Stop `bun run dev` before continuing; the web app, API, and worker run outside Docker.
EOF

if [[ ! -t 0 ]]; then
  echo "Run this command in a terminal to confirm the reset." >&2
  exit 1
fi

if ! read -r -p "Type RESET to continue: " confirmation; then
  echo "Reset cancelled; no containers or volumes were changed."
  exit 0
fi

if [[ "$confirmation" != "RESET" ]]; then
  echo "Reset cancelled; no containers or volumes were changed."
  exit 0
fi

docker compose --project-name care-platform-dev -f compose.yaml down --volumes --remove-orphans
docker compose --project-name care-platform-dev -f compose.yaml up -d --wait
bun run migrate
bun run seed

cat <<'EOF'
Local infrastructure is running; migrations and demo data are restored.
Authentik users were deleted. Create your Authentik user, then grant it demo
tenant access with:

DEV_SEED_OIDC_SUB=<new-authentik-user-uuid> bun run seed:identity
EOF
