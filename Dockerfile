# Stage 1: Build the React frontend
FROM node:20 AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

# Stage 2: Setup the backend and final image
FROM node:20
WORKDIR /app

# Install build tools for native modules like better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install backend dependencies first to leverage Docker layer caching
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm install --legacy-peer-deps --production

# Copy backend source code
COPY backend/ ./

# Copy compiled frontend from Stage 1
WORKDIR /app
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose the application port (Render will inject its own PORT env var)
WORKDIR /app/backend
EXPOSE 3001
ENV NODE_ENV=production

# Start the server
CMD ["node", "server.js"]
