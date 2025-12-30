FROM node:20-alpine AS builder

WORKDIR /app

# Install deps (dev deps needed for build/tsc)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

# Build (runs prisma generate + tsc via npm script)
RUN npm run build

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
