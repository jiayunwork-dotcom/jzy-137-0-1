# ---- build stage: compile TypeScript and install production deps ----
FROM node:20-slim AS build
WORKDIR /app

# Toolchain for better-sqlite3 in case no prebuilt binary matches the
# platform (prebuilds are used when available and this is a no-op then).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime stage ----
FROM node:20-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/rainflow.db
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "dist/index.js"]
