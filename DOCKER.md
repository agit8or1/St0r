# 🐳 St0r Docker Setup Guide

## Overview

This guide explains how to run St0r as a Docker container alongside an existing UrBackup Server installation.

**Requirements:**
- Docker & Docker Compose installed
- UrBackup Server already installed and running on the host
- Access to UrBackup database files (`/var/urbackup/backup_server.db`)

---

## Quick Start (3 Minutes)

### 1. Clone Your Fork

```bash
git clone https://github.com/iippam/St0r.git
cd St0r
git checkout docker-implementation
```

### 2. Configure Environment

```bash
cp .env.example.docker .env
```

Edit `.env` and set secure secrets:

```bash
# Generate secrets (run twice)
openssl rand -hex 32

# Update in .env:
JWT_SECRET=<generated_value_1>
APP_SECRET_KEY=<generated_value_2>
```

### 3. Build and Start

```bash
# Build Docker image
docker-compose build

# Start all containers (MariaDB + St0r)
docker-compose up -d

# Check status
docker-compose ps
```

### 4. Access the Web UI

```
http://<YOUR_SERVER_IP>
```

**Default credentials:**
- Username: `admin`
- Password: `admin123`

⚠️ **Change password immediately after first login!**

---

## Detailed Setup

### Prerequisites

#### Install Docker & Docker Compose

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose
sudo usermod -aG docker $USER
newgrp docker  # Apply group changes
```

**CentOS/RHEL:**
```bash
sudo yum install -y docker
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

**Verify installation:**
```bash
docker --version
docker-compose --version
```

#### UrBackup Server Already Running

Verify UrBackup is running on the host:

```bash
sudo systemctl status urbackupsrv

# Or check if database exists
ls -la /var/urbackup/backup_server.db
```

### Step 1: Clone the Repository

```bash
git clone https://github.com/iippam/St0r.git
cd St0r
```

Checkout the docker branch:
```bash
git checkout docker-implementation
```

### Step 2: Create Environment File

```bash
cp .env.example.docker .env
nano .env  # or vim, edit with your favorite editor
```

**Example `.env` configuration:**

```bash
# Database
DB_ROOT_PASSWORD=my_secure_root_password
DB_NAME=urbackup_gui
DB_USER=urbackup
DB_PASSWORD=my_secure_db_password

# Security (IMPORTANT: Generate with openssl rand -hex 32)
JWT_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f
APP_SECRET_KEY=f1e2d3c4b5a6z7y8x9w0v1u2t3s4r5q6p7o8n9m0l1k2j3i4h5g6f7e8d9c0b1

# UrBackup Configuration
URBACKUP_DB_PATH=/var/urbackup/backup_server.db
URBACKUP_API_URL=http://host.docker.internal:55414/x
URBACKUP_USERNAME=admin
URBACKUP_PASSWORD=

# Ports
HTTP_PORT=80
API_PORT=3000
```

### Step 3: Build the Docker Image

```bash
# Build from Dockerfile
docker-compose build

# Optional: Build with specific version
docker-compose build --no-cache
```

This will:
- Pull Node.js 20 Alpine base image
- Install system dependencies
- Build backend (TypeScript → JavaScript)
- Build frontend (React → static files)
- Create optimized runtime image

### Step 4: Start the Containers

```bash
# Start in background
docker-compose up -d

# Or start in foreground (for debugging)
docker-compose up
```

Expected output:
```
Creating st0r-db ...
Creating st0r-db ... done
Creating st0r-app ...
Creating st0r-app ... done
```

### Step 5: Verify Services are Running

```bash
# Check containers
docker-compose ps

# Expected output:
# NAME         COMMAND                  SERVICE    STATUS
# st0r-db      docker-entrypoint.s...  mariadb    Up 2 seconds
# st0r-app     /usr/local/bin/docker-e...  st0r       Up 1 second
```

Check logs:
```bash
# View St0r application logs
docker-compose logs st0r

# View MariaDB logs
docker-compose logs mariadb

# Follow logs in real-time
docker-compose logs -f st0r
```

### Step 6: Access the Web Interface

Open a web browser and navigate to:
```
http://<YOUR_SERVER_IP>
```

Or:
```
http://localhost
```

**Default credentials:**
- Username: `admin`
- Password: `admin123`

### Step 7: Change Default Password

1. Log in with default credentials
2. Click **Profile** (top-right menu)
3. Click **Change Password**
4. Enter new secure password
5. Click **Save**

---

## Volume Mounts Explained

The `docker-compose.yml` mounts these volumes:

| Host Path | Container Path | Mode | Purpose |
|-----------|----------------|------|--------|
| `/var/urbackup/backup_server.db` | `/var/urbackup/backup_server.db` | ro | UrBackup database (read-only) |
| `/var/urbackup/backup_server_settings.db` | `/var/urbackup/backup_server_settings.db` | ro | UrBackup settings (read-only) |
| `st0r_data` | `/opt/urbackup-gui/backend/data` | rw | St0r persistent data |
| `mariadb_data` | `/var/lib/mysql` | rw | MariaDB database storage |

**Important:** UrBackup database files must exist on the host before starting the container!

---

## Environment Variables Reference

### Database Configuration

```bash
DB_HOST=mariadb              # Container name (don't change)
DB_PORT=3306                 # MySQL port (don't change)
DB_NAME=urbackup_gui         # Database name
DB_USER=urbackup             # Database user
DB_PASSWORD=***              # Database password (CHANGE THIS)
DB_ROOT_PASSWORD=***         # MySQL root password (CHANGE THIS)
```

### Application Configuration

```bash
NODE_ENV=production          # Environment (don't change)
PORT=3000                    # Backend port (don't change)
```

### Security

```bash
JWT_SECRET=***               # Session token secret (GENERATE WITH openssl)
APP_SECRET_KEY=***           # Encryption key (GENERATE WITH openssl)
COOKIE_SECURE=false          # Set to true if using HTTPS
```

### UrBackup Connection

```bash
URBACKUP_DB_PATH=/var/urbackup/backup_server.db
URBACKUP_API_URL=http://host.docker.internal:55414/x
URBACKUP_USERNAME=admin
URBACKUP_PASSWORD=           # UrBackup password (optional)
```

**Note:** `host.docker.internal` allows containers to connect to services on the host.

---

## Troubleshooting

### Container Won't Start

**Check logs:**
```bash
docker-compose logs st0r
```

**Common issues:**

1. **"Cannot connect to MariaDB"**
   ```bash
   # Wait for database to initialize
   docker-compose logs mariadb
   # MariaDB takes ~10 seconds to start
   sleep 15
   docker-compose restart st0r
   ```

2. **"UrBackup database not found"**
   ```bash
   # Verify file exists
   ls -la /var/urbackup/backup_server.db
   
   # Check permissions
   sudo chmod 644 /var/urbackup/backup_server.db
   ```

3. **"Permission denied"**
   ```bash
   # Fix volume permissions
   sudo chown -R 1000:1000 /var/urbackup/backup_server.db
   ```

### Cannot Access Web UI

```bash
# Check if port 80 is already in use
sudo lsof -i :80

# Use different port
HTTP_PORT=8080 docker-compose up -d
# Access at: http://localhost:8080
```

### Database Connection Issues

```bash
# Test database connection from host
mysql -h 127.0.0.1 -u urbackup -p urbackup_gui

# From inside container
docker exec st0r-app mysql -h mariadb -u urbackup -p urbackup_gui
```

### View Real-time Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f st0r
docker-compose logs -f mariadb

# Last 50 lines
docker-compose logs --tail=50 st0r
```

---

## Service Management

### Start/Stop/Restart

```bash
# Start services
docker-compose up -d

# Stop services (data preserved)
docker-compose down

# Restart all services
docker-compose restart

# Restart specific service
docker-compose restart st0r
```

### View Status

```bash
# Running containers
docker-compose ps

# Container resource usage
docker stats st0r-app st0r-db

# Network connectivity
docker exec st0r-app ping -c 3 mariadb
```

### Execute Commands

```bash
# Open shell in container
docker exec -it st0r-app sh

# Run command in container
docker exec st0r-app node --version

# View file in container
docker exec st0r-app cat /opt/urbackup-gui/backend/.env
```

---

## Backup & Restore

### Backup Database

```bash
# Backup MariaDB data
docker exec st0r-db mysqldump -u root -p$DB_ROOT_PASSWORD urbackup_gui > backup.sql

# Backup volumes
docker run --rm -v st0r_data:/data -v $(pwd):/backup alpine tar czf /backup/st0r_data_backup.tar.gz -C /data .
```

### Restore Database

```bash
# Restore from backup
docker exec -i st0r-db mysql -u root -p$DB_ROOT_PASSWORD urbackup_gui < backup.sql

# Restore volumes
docker run --rm -v st0r_data:/data -v $(pwd):/backup alpine tar xzf /backup/st0r_data_backup.tar.gz -C /data
```

---

## Updating St0r

### Pull Latest Changes

```bash
git pull origin docker-implementation
```

### Rebuild and Restart

```bash
# Rebuild image with latest code
docker-compose build --no-cache

# Stop old containers
docker-compose down

# Start new containers
docker-compose up -d
```

---

## Offline Environment Setup

For servers with **no internet access**:

### On Internet Machine

```bash
# Download Docker images
docker pull node:20-alpine
docker pull mariadb:11.4-alpine

# Save images to file
docker save -o docker-images.tar \
  node:20-alpine \
  mariadb:11.4-alpine

# Copy to USB drive
cp docker-images.tar /media/usb/
```

### On Offline Server

```bash
# Load images
docker load -i /path/to/docker-images.tar

# Clone repository (or copy from USB)
git clone https://github.com/iippam/St0r.git
cd St0r

# Continue with normal setup
cp .env.example.docker .env
docker-compose up -d
```

---

## Security Considerations

✅ **Implemented:**
- Non-root user (UID 1000)
- Read-only mounts for UrBackup database
- Encrypted credentials in `.env`
- Network isolation (bridge network)
- Health checks enabled
- Random JWT & APP secrets

🔒 **Additional Steps:**

1. **Use HTTPS**
   ```bash
   # Add reverse proxy with Certbot
   # Or use external nginx with SSL termination
   ```

2. **Restrict Network Access**
   ```bash
   # Only allow internal network
   # Firewall: allow 80 from trusted IPs only
   ```

3. **Enable 2FA**
   - Login to St0r
   - Profile → Enable 2FA
   - Scan QR code with authenticator app

---

## Performance Tuning

### Increase Resources

Edit `docker-compose.yml`:

```yaml
st0r:
  deploy:
    resources:
      limits:
        cpus: '2'
        memory: 2G
      reservations:
        cpus: '1'
        memory: 1G
```

### Monitor Performance

```bash
# Real-time stats
docker stats

# Detailed container info
docker inspect st0r-app
```

---

## Advanced Topics

### Using External Database

If you want to use an existing MariaDB/MySQL:

1. Comment out `mariadb` service in `docker-compose.yml`
2. Update environment variables:
   ```bash
   DB_HOST=your-external-db.com
   DB_PORT=3306
   ```
3. Ensure database and user are created

### Running Multiple Instances

```bash
# Create separate directories
mkdir st0r-instance-1 st0r-instance-2
cd st0r-instance-1
cp -r ../St0r/* .
docker-compose -p st0r-1 up -d

cd ../st0r-instance-2
cp -r ../St0r/* .
HTTP_PORT=8080 docker-compose -p st0r-2 up -d
```

---

## Support & Troubleshooting

- **Logs:** `docker-compose logs -f`
- **Issues:** https://github.com/iippam/St0r/issues
- **Documentation:** See `DOCKER.md` (this file)

---

## Next Steps

1. ✅ Deploy using Docker Compose
2. ✅ Change default password
3. ✅ Enable 2FA for admin account
4. ✅ Configure backup clients in UrBackup
5. ✅ Monitor backups from St0r dashboard

---

**Version:** 1.0  
**Last Updated:** 2026-05-29  
**Maintained by:** iippam