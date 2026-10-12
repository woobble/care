FROM oven/bun:1.4.2 AS pruner
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
RUN bunx turbo prune @care/worker --docker --production

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
RUN bunx turbo run build --filter=@care/worker...

FROM oven/bun:1.4.2 AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=dependencies --chown=bun:bun /repo/node_modules ./node_modules
COPY --from=dependencies --chown=bun:bun /repo/apps ./apps
COPY --from=dependencies --chown=bun:bun /repo/modules ./modules
COPY --from=dependencies --chown=bun:bun /repo/packages ./packages
COPY --from=build --chown=bun:bun /repo/apps/worker/package.json ./apps/worker/package.json
COPY --from=build --chown=bun:bun /repo/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=bun:bun /repo/packages ./packages
COPY --from=build --chown=bun:bun /repo/modules ./modules
USER bun
CMD ["bun", "apps/worker/dist/main.js"]
