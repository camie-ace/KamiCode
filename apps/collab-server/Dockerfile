FROM oven/bun:1.3.11 AS deps
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

FROM deps AS build
RUN bun run --filter @t3tools/collab-server build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/collab-server/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY apps/collab-server/package.json ./package.json
EXPOSE 8787
CMD ["node", "dist/index.mjs"]
