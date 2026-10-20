FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS build
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=care-bun-install,target=/root/.bun/install/cache \
  bun install --frozen-lockfile
RUN bunx turbo run openapi --filter=@care/api
RUN bunx turbo run build --filter=@care/web...
RUN bun build \
  apps/web/src/standalone-server.ts \
  --packages bundle \
  --target bun \
  --outfile apps/web/.next/standalone/apps/web/standalone-server.js

FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373 AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN apk add --no-cache 'zlib=1.3.2-r1'
COPY --from=build --chown=bun:bun /repo/apps/web/.next/standalone ./
COPY --from=build --chown=bun:bun /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=bun:bun /repo/apps/web/public ./apps/web/public
WORKDIR /repo/apps/web
USER bun
EXPOSE 3000
CMD ["bun", "standalone-server.js"]
