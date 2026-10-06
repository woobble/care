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
COPY --from=dependencies /repo/node_modules ./node_modules
COPY --from=dependencies /repo/apps ./apps
COPY --from=dependencies /repo/modules ./modules
COPY --from=dependencies /repo/packages ./packages
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/modules ./modules
COPY --from=build /repo/packages ./packages
EXPOSE 3001
CMD ["bun", "apps/api/dist/main.js"]
