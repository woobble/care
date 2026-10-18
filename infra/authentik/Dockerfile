FROM ghcr.io/goauthentik/server:2026.8.4@sha256:e7226ae116dac5aa0a5643803e735b010038f492c401e08e16b3bf1ac54c090c

USER root

RUN apt-mark unhold libssl-dev libssl3t64 openssl \
  && apt-get update \
  && apt-get install --no-install-recommends --yes \
    libssl-dev=3.5.7-1~deb13u3 \
    libssl3t64=3.5.7-1~deb13u3 \
    openssl=3.5.7-1~deb13u3 \
  && rm -rf /var/lib/apt/lists/*

RUN printf '%s\n' \
    'urllib3==2.8.0 --hash=sha256:0cf3cae568d36aa9576b28dfb35f11328f1cb974ca7647d9475ebb86c75ac6e3' \
    > /tmp/authentik-security-requirements.txt \
  && pip3 --python /ak-root/.venv/bin/python install \
    --no-deps \
    --no-cache-dir \
    --require-hashes \
    -r /tmp/authentik-security-requirements.txt \
  && rm -f /tmp/authentik-security-requirements.txt \
  && rm -rf /usr/local/lib/python3.14/site-packages/pip \
    /usr/local/lib/python3.14/site-packages/pip-*.dist-info \
    /usr/local/bin/pip /usr/local/bin/pip3 /usr/local/bin/pip3.14

# Authentik does not need privileged account, mount, or namespace utilities.
# Remove inherited setuid elevation from the base image; the runtime user is
# unprivileged and container startup never needs these elevation paths.
RUN find / -xdev -type f -perm -4000 -exec chmod u-s {} + \
  && test -z "$(find / -xdev -type f -perm -4000 -print -quit)"

USER authentik

LABEL org.opencontainers.image.source="https://github.com/goauthentik/authentik" \
  org.opencontainers.image.version="2026.8.4-care-openssl-deb13u3-urllib3-2.8.0" \
  org.opencontainers.image.base.name="ghcr.io/goauthentik/server:2026.8.4" \
  org.opencontainers.image.base.digest="sha256:e7226ae116dac5aa0a5643803e735b010038f492c401e08e16b3bf1ac54c090c"
