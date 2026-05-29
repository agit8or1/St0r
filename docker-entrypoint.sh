#!/bin/bash
set -e

echo "🐳 Starting St0r GUI..."
echo "Version: $(cat /opt/urbackup-gui/version.json 2>/dev/null || echo 'unknown')"
echo ""

# Wait for MariaDB to be ready
if [ -n "$DB_HOST" ]; then
    echo "⏳ Waiting for MariaDB at $DB_HOST:${DB_PORT:-3306}..."
    for i in {1..30}; do
        if nc -z "$DB_HOST" "${DB_PORT:-3306}" 2>/dev/null; then
            echo "✓ MariaDB is ready"
            break
        fi
        if [ $i -eq 30 ]; then
            echo "✗ MariaDB connection timeout"
            exit 1
        fi
        sleep 1
    done
fi

# Initialize database if needed
if [ -n "$DB_HOST" ]; then
    echo "📦 Initializing database..."
    mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < /opt/urbackup-gui/database/init/01_schema.sql 2>/dev/null || echo "  (schema may already exist)"
    
    # Apply migrations
    for mig in /opt/urbackup-gui/database/migrations/*.sql; do
        if [ -f "$mig" ]; then
            echo "  Applying migration: $(basename "$mig")..."
            mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < "$mig" 2>/dev/null || true
        fi
    done
    echo "✓ Database initialization complete"
fi

# Verify UrBackup database accessibility
if [ -f "$URBACKUP_DB_PATH" ]; then
    echo "✓ UrBackup database found at $URBACKUP_DB_PATH"
else
    echo "⚠ Warning: UrBackup database not found at $URBACKUP_DB_PATH"
    echo "  Make sure the volume is properly mounted!"
fi

echo ""
echo "🌐 Starting services..."

# Start Nginx in background
echo "  • Starting Nginx (HTTP/80)..."
nginx -g 'daemon off;' &
NGINX_PID=$!

# Give Nginx a moment to start
sleep 1

# Start backend
echo "  • Starting backend API (port 3000)..."
echo ""
echo "════════════════════════════════════════════════════════════════════════════════════"
echo "✓ St0r GUI is running!"
echo "════════════════════════════════════════════════════════════════════════════════════"
echo ""
echo "📋 Access at: http://localhost or http://<YOUR_SERVER_IP>"
echo "🔐 Default credentials:"
echo "   Username: admin"
echo "   Password: admin123"
echo ""
echo "⚠️  IMPORTANT: Change the default password after first login!"
echo "   Profile → Change Password"
echo ""
echo "════════════════════════════════════════════════════════════════════════════════════"
echo ""

cd /opt/urbackup-gui/backend
node dist/server.js