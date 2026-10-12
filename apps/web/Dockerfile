FROM oven/bun:1.4.2 AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
RUN bunx turbo run openapi --filter=@care/api
RUN bunx turbo run build --filter=@care/web...
RUN bun build \
  apps/web/src/standalone-server.ts \
  --packages bundle \
  --target bun \
  --outfile apps/web/.next/standalone/apps/web/standalone-server.js

FROM oven/bun:1.4.2 AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build --chown=bun:bun /repo/apps/web/.next/standalone ./
COPY --from=build --chown=bun:bun /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=bun:bun /repo/apps/web/public ./apps/web/public
WORKDIR /repo/apps/web
USER bun
EXPOSE 3000
CMD ["bun", "standalone-server.js"]
