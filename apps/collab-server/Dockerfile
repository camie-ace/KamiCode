FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
RUN pnpm --filter @t3tools/collab-server build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/collab-server/node_modules ./apps/collab-server/node_modules
COPY --from=build /app/apps/collab-server/dist ./apps/collab-server/dist
COPY apps/collab-server/package.json ./apps/collab-server/package.json
WORKDIR /app/apps/collab-server
EXPOSE 8787
CMD ["node", "dist/index.mjs"]
