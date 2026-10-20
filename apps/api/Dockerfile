FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS pruner
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=care-bun-install,target=/root/.bun/install/cache \
  bun install --frozen-lockfile
RUN bunx turbo prune @care/api --docker --production

FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS dependencies
WORKDIR /repo
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/bun.lock ./bun.lock
# Bun retains workspace devDependencies during production installs; these compilers are build-only.
RUN --mount=type=cache,id=care-bun-install,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --production \
  && rm -rf node_modules/.bun/typescript@* node_modules/.bun/@typescript+typescript-*

FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS build
WORKDIR /repo
COPY --from=pruner /repo/out/full/ ./
COPY --from=pruner /repo/out/bun.lock ./bun.lock
COPY --from=pruner /repo/node_modules ./node_modules
COPY tsconfig.json ./tsconfig.json
RUN bunx turbo run build --filter=@care/api...

FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV CARE_DISABLE_DOTENV=true
RUN apk add --no-cache 'zlib=1.3.2-r1'
COPY --from=dependencies --chown=bun:bun /repo/node_modules ./node_modules
COPY --from=dependencies --chown=bun:bun /repo/apps ./apps
COPY --from=dependencies --chown=bun:bun /repo/modules ./modules
COPY --from=dependencies --chown=bun:bun /repo/packages ./packages
COPY --from=build --chown=bun:bun /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=bun:bun /repo/apps/api/src ./apps/api/src
COPY --from=build --chown=bun:bun /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=bun:bun /repo/modules ./modules
COPY --from=build --chown=bun:bun /repo/packages ./packages
COPY --from=build --chown=bun:bun /repo/tsconfig.json ./tsconfig.json
USER bun
EXPOSE 3001
CMD ["bun", "apps/api/src/main.ts"]

FROM runtime AS operator
USER root
RUN apk add --no-cache ca-certificates postgresql18-client
USER bun
CMD ["bun", "apps/api/dist/ops/cli.js"]
