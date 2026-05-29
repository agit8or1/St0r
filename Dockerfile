# Build stage for backend
FROM node:20-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend . 
RUN npm run build

# Build stage for frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend .
RUN npm run build

# Runtime stage
FROM node:20-alpine
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    nginx \
    mariadb-client \
    sqlite \
    curl \
    bash \
    netcat-openbsd

# Create app directory structure
RUN mkdir -p /opt/urbackup-gui/backend /opt/urbackup-gui/frontend

# Copy backend from builder
COPY --from=backend-builder /app/backend/dist /opt/urbackup-gui/backend/dist
COPY --from=backend-builder /app/backend/node_modules /opt/urbackup-gui/backend/node_modules
COPY backend/package*.json /opt/urbackup-gui/backend/

# Copy frontend from builder
COPY --from=frontend-builder /app/frontend/dist /opt/urbackup-gui/frontend/dist

# Copy database schemas
COPY database /opt/urbackup-gui/database

# Copy Nginx config and customize for Docker
COPY setup/nginx-site.conf /etc/nginx/http.d/default.conf

# Copy startup script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create non-root user
RUN addgroup -g 1000 appuser && adduser -D -u 1000 -G appuser appuser
RUN chown -R appuser:appuser /opt/urbackup-gui

# Create Nginx runtime directories
RUN mkdir -p /var/run/nginx /var/log/nginx && chown -R appuser:appuser /var/run/nginx /var/log/nginx

# Expose ports
EXPOSE 80 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]