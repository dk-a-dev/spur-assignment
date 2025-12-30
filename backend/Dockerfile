FROM node:20-alpine AS builder

WORKDIR /app

# Optional: supply DATABASE_URL if you want to run migrations during build (not used here).
ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}

# Install deps (dev deps needed for build/tsc)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

# Build without running migrations; migrations should be handled separately (e.g., web service)
RUN npm run build:no-migrate

FROM node:20-alpine AS runner
WORKDIR /app

# Only production deps (includes @prisma/client)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Bring over built artifacts and Prisma engines
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma

ENV PORT=8080
EXPOSE 8080

# Override the command per service (web vs worker). Default to worker here.
CMD ["node", "dist/src/worker.js"]
