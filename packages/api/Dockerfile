FROM node:22-alpine AS base
WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY packages/api/package*.json ./packages/api/
RUN npm ci --workspace=packages/api --ignore-scripts

# Copy source
COPY packages/api ./packages/api

# Generate Prisma client and build TypeScript
WORKDIR /app/packages/api
RUN npx prisma generate
RUN npm run build

# Production image
FROM node:22-alpine
WORKDIR /app/packages/api

COPY --from=base /app/packages/api/dist ./dist
COPY --from=base /app/packages/api/prisma ./prisma
COPY --from=base /app/packages/api/node_modules ./node_modules
COPY --from=base /app/node_modules /app/node_modules

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
