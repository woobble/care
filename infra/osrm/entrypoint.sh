#!/bin/bash
set -euo pipefail

dataset_name="$(</data/current/dataset-name)"
if [[ ! "$dataset_name" =~ ^[a-z0-9_-]+$ ]]; then
  echo "Invalid OSRM dataset name in /data/current/dataset-name" >&2
  exit 1
fi

exec osrm-routed --algorithm mld "/data/current/${dataset_name}.osrm"
