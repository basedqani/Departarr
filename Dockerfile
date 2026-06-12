# ---- Build stage ----
FROM node:22-alpine AS build
WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package*.json ./
COPY packages/api/package*.json ./packages/api/
COPY apps/web/package*.json ./apps/web/

RUN npm ci --ignore-scripts

# Copy all source
COPY packages/api ./packages/api
COPY apps/web ./apps/web

# Build web
WORKDIR /app/apps/web
RUN npm run build

# Build API (prisma generate + tsc)
WORKDIR /app/packages/api
RUN npx prisma generate
RUN npm run build

# ---- Runtime stage ----
FROM node:22-alpine AS runtime
WORKDIR /app

# Install only production deps
COPY package*.json ./
COPY packages/api/package*.json ./packages/api/

RUN npm ci --workspace=packages/api --omit=dev --ignore-scripts

# Copy API build artifacts
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/packages/api/prisma ./packages/api/prisma
# Copy generated Prisma client (already in node_modules from npm ci --omit=dev above;
# regenerate to ensure correct binary)
WORKDIR /app/packages/api
RUN npx prisma generate

# Copy built web assets
COPY --from=build /app/apps/web/dist /app/web

# Environment
ENV DATABASE_URL=file:/data/departarr.db \
    NODE_ENV=production \
    PORT=8080 \
    WEB_DIST=/app/web

EXPOSE 8080
VOLUME ["/data"]

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
