#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to reset the local application." >&2
  exit 1
fi

docker compose config --quiet

cat <<'EOF'
This resets the current Compose project. It deletes its containers and volumes,
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

docker compose down --volumes --remove-orphans
docker compose up -d --wait
bun run migrate
bun run seed

cat <<'EOF'
Local infrastructure is running; migrations and demo data are restored.
Authentik users were deleted. Create your Authentik user, then grant it demo
tenant access with:

DEV_SEED_OIDC_SUB=<new-authentik-user-uuid> bun run seed:identity
EOF
