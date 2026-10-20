FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS pruner
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=care-bun-install,target=/root/.bun/install/cache \
  bun install --frozen-lockfile
RUN bunx turbo prune @care/worker --docker --production

FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS dependencies
WORKDIR /repo
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/bun.lock ./bun.lock
RUN --mount=type=cache,id=care-bun-install,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --production

FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS build
WORKDIR /repo
COPY --from=pruner /repo/out/full/ ./
COPY --from=pruner /repo/out/bun.lock ./bun.lock
COPY --from=pruner /repo/node_modules ./node_modules
RUN bunx turbo run build --filter=@care/worker...

FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS runtime
WORKDIR /repo
ENV NODE_ENV=production
RUN apk add --no-cache 'zlib=1.3.2-r1'
COPY --from=dependencies --chown=bun:bun /repo/node_modules ./node_modules
COPY --from=dependencies --chown=bun:bun /repo/apps ./apps
COPY --from=dependencies --chown=bun:bun /repo/modules ./modules
COPY --from=dependencies --chown=bun:bun /repo/packages ./packages
COPY --from=build --chown=bun:bun /repo/apps/worker/package.json ./apps/worker/package.json
COPY --from=build --chown=bun:bun /repo/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=bun:bun /repo/packages ./packages
COPY --from=build --chown=bun:bun /repo/modules ./modules
COPY --from=pruner --chown=bun:bun /repo/tsconfig.json ./tsconfig.json
USER bun
CMD ["bun", "apps/worker/dist/main.js"]
