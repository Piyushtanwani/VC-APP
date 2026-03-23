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

# Install backend dependencies first to leverage Docker layer caching
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm install --legacy-peer-deps --production

# Copy backend source code
COPY backend/ ./

# Copy compiled frontend from Stage 1
# We place it in /app/frontend/dist so the backend can serve it from ../frontend/dist
WORKDIR /app
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose the application port
WORKDIR /app/backend
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# Start the server
CMD ["node", "server.js"]
