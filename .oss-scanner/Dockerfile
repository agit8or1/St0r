# Build environment for Anthropic's OSS Scanner (https://github.com/anthropics/oss-scanner).
#
# The scanner builds this with the repository as the build context, then removes network access. Everything the
# backend, frontend and agent need to build, and to run locally for testing, is fetched here.
#
# Nothing in this image is a real deployment: the database password, JWT secret and encryption key below are
# throwaway values generated at build time, and UrBackup itself is replaced by the repository's own mock API.
FROM node:22-bookworm
ENV DEBIAN_FRONTEND=noninteractive \
    CI=true \
    HUSKY=0
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates git python3 build-essential sqlite3 mariadb-server mariadb-client curl procps \
    && rm -rf /var/lib/apt/lists/*

# scanner contract: the checkout lives inside the image, at /src
COPY . /src
WORKDIR /src

# Backend (Express + TypeScript, compiled to backend/dist). Same steps as install.sh.
RUN cd backend && npm ci && npm run build

# Frontend (React + Vite, typechecked by tsc, built to frontend/dist, which the backend serves).
RUN cd frontend && npm ci && npm run build

# stor-agent (the root daemon installed on managed remote servers). It has no lockfile.
RUN cd agent && npm install --no-audit --no-fund && npm run build

# A local MariaDB holding the application schema, so the backend can be started and exercised offline.
RUN set -eu; \
    DB_PASSWORD="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"; \
    mysqld_safe --user=mysql --skip-networking=0 --bind-address=127.0.0.1 >/dev/null 2>&1 & \
    for i in $(seq 1 30); do mysqladmin ping --silent && break; sleep 1; done; \
    mysql -e "CREATE DATABASE urbackup_gui CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; \
              CREATE USER 'urbackup'@'localhost' IDENTIFIED BY '${DB_PASSWORD}'; \
              GRANT ALL PRIVILEGES ON urbackup_gui.* TO 'urbackup'@'localhost'; FLUSH PRIVILEGES;"; \
    mysql urbackup_gui < database/init/01_schema.sql; \
    for m in database/migrations/*.sql; do mysql urbackup_gui < "$m" || echo "WARNING: migration $m failed"; done; \
    mysqladmin shutdown; \
    printf '%s\n' \
      'NODE_ENV=development' 'PORT=3000' \
      'DB_HOST=127.0.0.1' 'DB_PORT=3306' 'DB_USER=urbackup' "DB_PASSWORD=${DB_PASSWORD}" 'DB_NAME=urbackup_gui' \
      "JWT_SECRET=$(head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
      "APP_SECRET_KEY=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
      'URBACKUP_API_URL=http://127.0.0.1:9714/x' 'URBACKUP_USERNAME=admin' 'URBACKUP_PASSWORD=' \
      'URBACKUP_DB_PATH=/var/urbackup/backup_server.db' 'URBACKUP_BACKUP_PATH=/srv/urbackup-storage' \
      > backend/.env; \
    mkdir -p /var/urbackup /srv/urbackup-storage

# /usr/local/bin/st0r-start: start MariaDB, the mock UrBackup API (port 9714) and the backend (port 3000).
# The first-run admin password is written to /src/initial-admin-password.txt.
RUN printf '%s\n' \
      '#!/bin/sh' \
      'set -e' \
      'mysqld_safe --user=mysql --bind-address=127.0.0.1 >/tmp/mariadb.log 2>&1 &' \
      'for i in $(seq 1 30); do mysqladmin ping --silent 2>/dev/null && break; sleep 1; done' \
      'node /src/scripts/demo/mock-urbackup-api.mjs --port 9714 >/tmp/mock-urbackup.log 2>&1 &' \
      'cd /src/backend && node dist/server.js >/tmp/backend.log 2>&1 &' \
      'for i in $(seq 1 30); do curl -fs http://127.0.0.1:3000/health >/dev/null && break; sleep 1; done' \
      'curl -fs http://127.0.0.1:3000/health && echo && echo "backend on http://127.0.0.1:3000 (logs in /tmp/*.log)"' \
      > /usr/local/bin/st0r-start \
    && chmod +x /usr/local/bin/st0r-start

# Smoke test: the backend boots against the local database and answers /health. Not fatal.
RUN (st0r-start || (echo "WARNING: backend smoke test failed"; tail -50 /tmp/backend.log || true)); \
    mysqladmin shutdown 2>/dev/null || true
