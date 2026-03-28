# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
# Cache dependencies
COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps
# Build the app
COPY frontend/ ./
RUN npm run build && npm cache clean --force

# Stage 2: Install backend production dependencies
FROM node:20-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install --legacy-peer-deps --production && npm cache clean --force

# Stage 3: Setup the final production image
FROM node:20-alpine
WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Create a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Copy backend dependencies
COPY --from=backend-builder --chown=appuser:appgroup /app/backend/node_modules ./backend/node_modules
# Copy backend source
COPY --chown=appuser:appgroup backend/ ./backend/
# Copy compiled frontend
COPY --from=frontend-builder --chown=appuser:appgroup /app/frontend/dist ./frontend/dist

# Setup production environment
WORKDIR /app/backend
EXPOSE 3001
ENV NODE_ENV=production
ENV PORT=3001

# Healthcheck to ensure the server is alive
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Start the server
CMD ["node", "server.js"]
