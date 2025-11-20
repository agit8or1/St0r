# st0r - UrBackup Web GUI

A modern, feature-rich web interface for managing and monitoring UrBackup servers.

**Important**: st0r is designed to be installed directly on Linux UrBackup servers and reads/writes directly from the UrBackup database for optimal performance and reliability.

## Features

- **Dashboard** - Real-time overview of backup status, client health, and active tasks
- **Client Management** - Monitor all backup clients with detailed status information
- **Activity Monitoring** - Track current and historical backup activities with progress indicators
- **Direct Database Access** - Reads directly from UrBackup's SQLite database for fast, reliable data access
- **Beautiful UI** - Modern, responsive design built with React and TailwindCSS
- **Secure** - JWT-based authentication with role-based access control

## Requirements

- **Linux UrBackup Server** - Must be installed on the same server as UrBackup
- **UrBackup Server 2.5.x or later** - Must have direct access to UrBackup's database

## Architecture

- **Frontend**: React + Vite + TailwindCSS
- **Backend**: Node.js + Express + TypeScript
- **Database**: MariaDB (for st0r data) + Direct SQLite access (for UrBackup data)
- **Web Server**: Nginx

## Quick Installation

### Automated Installation (Recommended)

Run the installation script as root:

```bash
cd /home/administrator/urbackup-gui
chmod +x install.sh
sudo ./install.sh
```

The script will:
1. Install all system dependencies (Node.js, MariaDB, nginx)
2. Set up the database with proper schema
3. Build the backend and frontend
4. Configure nginx
5. Set up systemd services
6. Start everything automatically

After installation, access the GUI at: **http://YOUR_SERVER_IP**

### Manual Installation

If you prefer to install manually:

#### 1. Install Dependencies

```bash
# Update system
sudo apt-get update

# Install dependencies
sudo apt-get install -y curl gnupg2 nginx mariadb-server

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
```

#### 2. Configure MariaDB

```bash
# Start MariaDB
sudo systemctl start mariadb
sudo systemctl enable mariadb

# Create database and user
sudo mysql -u root <<EOF
CREATE DATABASE urbackup_gui;
CREATE USER 'urbackup'@'localhost' IDENTIFIED BY 'urbackup123';
GRANT ALL PRIVILEGES ON urbackup_gui.* TO 'urbackup'@'localhost';
FLUSH PRIVILEGES;
EOF

# Import schema
sudo mysql -u root urbackup_gui < database/init/01_schema.sql
```

#### 3. Install Application

```bash
# Create installation directory
sudo mkdir -p /opt/urbackup-gui
sudo cp -r . /opt/urbackup-gui/
sudo chown -R $USER:$USER /opt/urbackup-gui

# Install and build backend
cd /opt/urbackup-gui/backend
npm install
npm run build

# Create .env file
cat > .env <<EOF
NODE_ENV=production
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=urbackup_gui
DB_USER=urbackup
DB_PASSWORD=urbackup123
JWT_SECRET=$(openssl rand -hex 32)
EOF

# Install and build frontend
cd /opt/urbackup-gui/frontend
npm install
npm run build
```

#### 4. Configure Services

```bash
# Install systemd service
sudo cp /opt/urbackup-gui/setup/urbackup-gui.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable urbackup-gui
sudo systemctl start urbackup-gui

# Configure nginx
sudo cp /opt/urbackup-gui/setup/nginx-site.conf /etc/nginx/sites-available/urbackup-gui
sudo ln -sf /etc/nginx/sites-available/urbackup-gui /etc/nginx/sites-enabled/urbackup-gui
sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl restart nginx
```

## Default Credentials

**Username**: `admin`
**Password**: `admin123`

**IMPORTANT**: Change the default password immediately after first login!

## Service Management

### Backend Service

```bash
# Check status
sudo systemctl status urbackup-gui

# Start service
sudo systemctl start urbackup-gui

# Stop service
sudo systemctl stop urbackup-gui

# Restart service
sudo systemctl restart urbackup-gui

# View logs
sudo journalctl -u urbackup-gui -f
```

### Nginx

```bash
# Check status
sudo systemctl status nginx

# Restart nginx
sudo systemctl restart nginx

# Test configuration
sudo nginx -t
```

### MariaDB

```bash
# Check status
sudo systemctl status mariadb

# Access database
sudo mysql -u root urbackup_gui
```

## Updating the Application

```bash
# Navigate to installation directory
cd /opt/urbackup-gui

# Pull latest changes (if using git)
git pull

# Update backend
cd backend
npm install
npm run build
sudo systemctl restart urbackup-gui

# Update frontend
cd ../frontend
npm install
npm run build
```

## Troubleshooting

### Backend not starting

```bash
# Check logs
sudo journalctl -u urbackup-gui -n 50

# Check if port 3000 is available
sudo lsof -i :3000

# Verify database connection
mysql -u urbackup -p urbackup_gui
```

### Nginx errors

```bash
# Check nginx error log
sudo tail -f /var/log/nginx/error.log

# Test nginx configuration
sudo nginx -t

# Check if port 80 is available
sudo lsof -i :80
```

### Database errors

```bash
# Check MariaDB status
sudo systemctl status mariadb

# Check MariaDB logs
sudo tail -f /var/log/mysql/error.log

# Verify database exists
sudo mysql -u root -e "SHOW DATABASES;"
```

## Security Considerations

1. **Change default credentials** immediately after installation
2. **Use strong passwords** for database and JWT secret
3. **Use HTTPS** in production (configure nginx with SSL certificates)
4. **Firewall rules** - Only expose necessary ports
5. **Regular updates** - Keep dependencies and system packages updated
6. **Backup database** - Regularly backup the MariaDB data

## Database Backup

```bash
# Backup
sudo mysqldump -u root urbackup_gui > backup.sql

# Restore
sudo mysql -u root urbackup_gui < backup.sql
```

## Configuring HTTPS

1. Install certbot:
```bash
sudo apt-get install certbot python3-certbot-nginx
```

2. Obtain certificate:
```bash
sudo certbot --nginx -d yourdomain.com
```

3. Certbot will automatically configure nginx for HTTPS

## Uninstallation

```bash
# Stop services
sudo systemctl stop urbackup-gui
sudo systemctl disable urbackup-gui

# Remove systemd service
sudo rm /etc/systemd/system/urbackup-gui.service
sudo systemctl daemon-reload

# Remove nginx configuration
sudo rm /etc/nginx/sites-enabled/urbackup-gui
sudo rm /etc/nginx/sites-available/urbackup-gui
sudo systemctl restart nginx

# Remove application
sudo rm -rf /opt/urbackup-gui

# Drop database (optional)
sudo mysql -u root -e "DROP DATABASE urbackup_gui; DROP USER 'urbackup'@'localhost';"
```

## Tech Stack

- **Frontend Framework**: React 18
- **Build Tool**: Vite
- **UI Styling**: TailwindCSS
- **Routing**: React Router
- **HTTP Client**: Axios
- **Icons**: Lucide React
- **Backend**: Node.js + Express
- **Language**: TypeScript
- **Database**: MariaDB (st0r data) + SQLite (UrBackup data via direct access)
- **Authentication**: JWT
- **Web Server**: Nginx

## License

MIT

## Support

For issues and questions, please create an issue in the repository.
