# ==============================================================================
# Restaurant Cloud — Production Multi-Stage Dockerfile for NestJS API
# Runtime: Node.js 22 LTS Alpine
# Monorepo: Turborepo + pnpm Workspaces
# ==============================================================================

# Stage 1: Build Dependencies and Compile TypeScript
FROM node:22-alpine AS builder

WORKDIR /app

# Enable Corepack for pnpm v12.18.0
RUN corepack enable && corepack prepare pnpm@12.18.0 --activate

# Copy monorepo configuration files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./

# Copy package descriptors for workspace dependency resolution
COPY packages/domain-kernel/package.json ./packages/domain-kernel/
COPY packages/shared-contracts/package.json ./packages/shared-contracts/
COPY packages/database/package.json ./packages/database/
COPY apps/api/package.json ./apps/api/

# Install dependencies (frozen lockfile for reproducible builds)
RUN pnpm install --frozen-lockfile

# Copy source code for backend and shared libraries
COPY packages/domain-kernel ./packages/domain-kernel
COPY packages/shared-contracts ./packages/shared-contracts
COPY packages/database ./packages/database
COPY apps/api ./apps/api

# Build shared libraries and NestJS API in topological order via Turborepo
RUN pnpm turbo run build --filter=@restaurant-cloud/api...

# Stage 2: Production Dependencies Pruning
FROM node:22-alpine AS pruner

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@12.18.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY packages/domain-kernel/package.json ./packages/domain-kernel/
COPY packages/shared-contracts/package.json ./packages/shared-contracts/
COPY packages/database/package.json ./packages/database/
COPY apps/api/package.json ./apps/api/

# Copy compiled artifacts from builder stage
COPY --from=builder /app/packages/domain-kernel/dist ./packages/domain-kernel/dist
COPY --from=builder /app/packages/shared-contracts/dist ./packages/shared-contracts/dist
COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Install production-only dependencies
RUN pnpm install --prod --frozen-lockfile

# Stage 3: Minimal Production Runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Security: Run as unprivileged non-root user (node: node)
USER node

# Copy production monorepo bundle
COPY --from=pruner --chown=node:node /app ./

WORKDIR /app/apps/api

EXPOSE 4000

# Container liveness healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 4000) + '/health/liveness', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start production server
CMD ["node", "dist/main.js"]
