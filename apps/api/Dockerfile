FROM oven/bun:1.4.2 AS pruner
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
RUN bunx turbo prune @care/api --docker --production

FROM oven/bun:1.4.2 AS dependencies
WORKDIR /repo
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/bun.lock ./bun.lock
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.2 AS build
WORKDIR /repo
COPY --from=pruner /repo/out/full/ ./
COPY --from=pruner /repo/out/bun.lock ./bun.lock
COPY --from=pruner /repo/node_modules ./node_modules
COPY tsconfig.json ./tsconfig.json
RUN bunx turbo run build --filter=@care/api...

FROM oven/bun:1.4.2 AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=dependencies --chown=bun:bun /repo/node_modules ./node_modules
COPY --from=dependencies --chown=bun:bun /repo/apps ./apps
COPY --from=dependencies --chown=bun:bun /repo/modules ./modules
COPY --from=dependencies --chown=bun:bun /repo/packages ./packages
COPY --from=build --chown=bun:bun /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=bun:bun /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=bun:bun /repo/modules ./modules
COPY --from=build --chown=bun:bun /repo/packages ./packages
COPY --from=build --chown=bun:bun /repo/tsconfig.json ./tsconfig.json
USER bun
EXPOSE 3001
CMD ["bun", "apps/api/dist/main.js"]

FROM runtime AS operator
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -d -m 0755 /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt trixie-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-18 \
  && rm -rf /var/lib/apt/lists/*
USER bun
CMD ["bun", "apps/api/dist/ops/cli.js"]
