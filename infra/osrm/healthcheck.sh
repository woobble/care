#!/bin/bash
set -euo pipefail

IFS= read -r route_probe < /data/current/route-probe
if [[ ! "$route_probe" =~ ^-?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?,-?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?\;-?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?,-?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?$ ]]; then
  echo "Invalid OSRM route probe in /data/current/route-probe" >&2
  exit 1
fi

exec 3<>/dev/tcp/127.0.0.1/5000
printf 'GET /route/v1/driving/%s?overview=false HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n' "$route_probe" >&3
response="$(cat <&3)"
exec 3>&-

[[ "$response" == HTTP/1.1\ 200* && "$response" == *'"code":"Ok"'* ]]
