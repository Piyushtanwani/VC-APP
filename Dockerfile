# Stage 1: Build the React frontend
FROM node:20 AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

# Stage 2: Install backend dependencies (with build tools)
FROM node:20 AS backend-builder
WORKDIR /app/backend

# Install build tools for native modules like better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./
RUN npm install --legacy-peer-deps --production

# Stage 3: Setup the final production image
FROM node:20-slim
WORKDIR /app

# Create backend directory
WORKDIR /app/backend

# Copy backend dependencies from Stage 2
COPY --from=backend-builder /app/backend/node_modules ./node_modules
# Copy backend source code
COPY backend/ ./

# Copy compiled frontend from Stage 1
WORKDIR /app
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Setup production environment
WORKDIR /app/backend
EXPOSE 3001
ENV NODE_ENV=production

# Start the server
CMD ["node", "server.js"]
