# Production image for timetable-api. Bun runs the TypeScript sources
# directly, so there is no build step: install runtime dependencies, copy
# `src`, and start the server.

FROM oven/bun:1.4.2-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.2-slim
WORKDIR /app
# Production mode never falls back to the in-memory MongoDB (a dev
# dependency), so MONGO_URI must point at a real server.
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER bun
EXPOSE 3000
# fastify-cli detects the container and listens on 0.0.0.0.
CMD ["bun", "run", "start"]
