# Stage 1: Build the React frontend
FROM node:20 AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

# Stage 2: Install backend production dependencies
FROM node:20 AS backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install --legacy-peer-deps --production

# Stage 3: Setup the final production image
FROM node:20-slim
WORKDIR /app

# Copy backend dependencies
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules
# Copy backend source
COPY backend/ ./backend/

# Copy compiled frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Setup production environment
WORKDIR /app/backend
EXPOSE 3001
ENV NODE_ENV=production

# Start the server
CMD ["node", "server.js"]
