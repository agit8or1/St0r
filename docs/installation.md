# Installation and operations

Detailed setup, update and removal steps. For the one-line install and an overview of what it changes,
see the [README](../README.md#quick-start).

- [Before you start](#before-you-start)
- [Automated installation](#automated-installation)
- [Manual installation](#manual-installation)
- [Configuration reference](#configuration-reference)
- [Running behind an existing web server](#running-behind-an-existing-web-server)
- [Enabling HTTPS](#enabling-https)
- [Service management](#service-management)
- [Updating](#updating)
- [Uninstalling](#uninstalling)
- [Replication setup](#replication-setup)
- [Troubleshooting](#troubleshooting)

---

## Before you start

St0r must be installed **on the same machine as UrBackup Server**. It opens UrBackup's SQLite databases
and the backup storage folder as local files, so a remote UrBackup server is not supported.

| | |
|---|---|
| UrBackup Server | 2.5.x — developed and verified against 2.5.38 |
| OS | Ubuntu or Debian (the installer uses `apt`) |
| Runtime | Node.js 20+, MariaDB, Nginx |

If UrBackup Server is not already installed, the automated installer will install it — from the
`ppa:uroni/urbackup` PPA on Ubuntu, or the official `.deb` on Debian.

---

## Automated installation

```bash
curl -fsSL https://raw.githubusercontent.com/agit8or1/St0r/main/install.sh | sudo bash
```

Or review it first, which is the better habit for a script run as root:

```bash
wget https://raw.githubusercontent.com/agit8or1/St0r/main/install.sh
less install.sh
sudo bash install.sh
```

The installer will:

1. Install Node.js 20, MariaDB, Nginx, `rsync`, `sqlite3` — and UrBackup Server if absent.
2. Create the `urbackup_gui` database and apply the schema and migrations.
3. Build the backend and frontend into `/opt/urbackup-gui`.
4. Write `/etc/nginx/sites-available/urbackup-gui`, enable it as the **default** site on port 80, and
   remove `/etc/nginx/sites-enabled/default`.
5. Add the service user to the `urbackup` group and make `/var/urbackup/backup_server*.db` group-writable.
6. Install and start the `urbackup-gui` systemd service.

Then open `http://YOUR_SERVER_IP` and sign in as `admin`. The installer prints the generated password when
it finishes; it is also in `/opt/urbackup-gui/initial-admin-password.txt` and the service log. You must
change it at first login. See [First login](../README.md#first-login).

---

## Manual installation

### 1. Dependencies

```bash
sudo apt-get update
sudo apt-get install -y curl gnupg2 nginx mariadb-server rsync sqlite3

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
```

### 2. Database

```bash
sudo systemctl enable --now mariadb

sudo mysql -u root <<'EOF'
CREATE DATABASE urbackup_gui CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'urbackup'@'localhost' IDENTIFIED BY 'CHANGE_ME';
GRANT ALL PRIVILEGES ON urbackup_gui.* TO 'urbackup'@'localhost';
FLUSH PRIVILEGES;
EOF

sudo mysql -u root urbackup_gui < database/init/01_schema.sql
for m in database/migrations/*.sql; do sudo mysql -u root urbackup_gui < "$m"; done
```

### 3. Application

```bash
sudo mkdir -p /opt/urbackup-gui
sudo cp -r . /opt/urbackup-gui/
sudo chown -R "$USER:$USER" /opt/urbackup-gui

cd /opt/urbackup-gui/backend
npm install && npm run build

cat > .env <<EOF
NODE_ENV=production
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=urbackup_gui
DB_USER=urbackup
DB_PASSWORD=CHANGE_ME
JWT_SECRET=$(openssl rand -hex 64)
APP_SECRET_KEY=$(openssl rand -hex 32)
URBACKUP_DB_PATH=/var/urbackup/backup_server.db
URBACKUP_API_URL=http://localhost:55414/x
URBACKUP_USERNAME=admin
URBACKUP_PASSWORD=
EOF

cd /opt/urbackup-gui/frontend
npm install && npm run build
```

`JWT_SECRET` and `APP_SECRET_KEY` are required — the backend refuses to start without a strong
`JWT_SECRET`. `APP_SECRET_KEY` is the key used to encrypt replication SSH credentials at rest; losing it
makes stored replication credentials unreadable.

### 4. Database access for the service user

St0r reads UrBackup's SQLite databases directly, and writes to them for a few operations:

```bash
sudo usermod -a -G urbackup "$USER"
sudo chmod g+w /var/urbackup/backup_server.db /var/urbackup/backup_server_settings.db
```

### 5. Services

```bash
sudo cp /opt/urbackup-gui/setup/urbackup-gui.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now urbackup-gui

sudo cp /opt/urbackup-gui/setup/nginx-site.conf /etc/nginx/sites-available/urbackup-gui
sudo ln -sf /etc/nginx/sites-available/urbackup-gui /etc/nginx/sites-enabled/urbackup-gui
sudo rm -f /etc/nginx/sites-enabled/default   # see the note below before running this
sudo nginx -t && sudo systemctl restart nginx
```

---

## Configuration reference

Backend settings live in `/opt/urbackup-gui/backend/.env`. The full annotated list is in
[`.env.example`](../.env.example). The ones that matter most:

| Variable | Purpose |
|---|---|
| `DB_*` | MariaDB connection for St0r's own database |
| `JWT_SECRET` | Session signing key. Required; no default is accepted |
| `APP_SECRET_KEY` | Encrypts replication SSH credentials at rest |
| `URBACKUP_DB_PATH` | Path to `backup_server.db` (default `/var/urbackup/backup_server.db`) |
| `URBACKUP_API_URL` | UrBackup HTTP API (default `http://localhost:55414/x`) |
| `URBACKUP_PASSWORD` | Leave empty if the UrBackup admin account has no password |
| `ST0R_DISK_*` | Disk guard thresholds — see `.env.example` |

`.env` is preserved across updates.

---

## Running behind an existing web server

The bundled Nginx site claims port 80 as `default_server` and the installer removes Nginx's default site.
If the machine already serves web content, skip that part and proxy to the backend instead — it listens on
`127.0.0.1:3000`:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location / {
    root /opt/urbackup-gui/frontend/dist;
    try_files $uri /index.html;
}
```

---

## Enabling HTTPS

The installer configures plain HTTP only. With the bundled Nginx site in place:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d backup.example.com
```

Do not expose St0r over plain HTTP to an untrusted network — session cookies and the login form travel in
clear text.

---

## Service management

```bash
sudo systemctl status urbackup-gui
sudo systemctl restart urbackup-gui
sudo journalctl -u urbackup-gui -f

sudo nginx -t && sudo systemctl restart nginx
```

---

## Updating

### From the interface

**About → Check for Updates → Update Now.** This runs `/opt/urbackup-gui/auto-update.sh`, which backs up
the current installation, downloads the release package, preserves `.env` and the `downloads` directory,
applies database migrations, reinstalls dependencies and restarts the service. It restores the backup
automatically if the service fails to come back up.

### From a checkout

```bash
cd /path/to/St0r
git pull
sudo ./deploy.sh
```

### Deploying only one half

The backend and the frontend can be deployed independently:

```bash
# Backend — needs a service restart
cd backend && npm run build
sudo rsync -a --delete dist/ /opt/urbackup-gui/backend/dist/
sudo systemctl restart urbackup-gui

# Frontend — nginx serves the files directly, so no restart
cd frontend && npm run build
sudo rsync -a --delete --exclude downloads dist/ /opt/urbackup-gui/frontend/dist/
```

`--exclude downloads` matters: `frontend/dist/downloads/` holds published installers and is not
build output.

### Layout

```
<checkout>/                     Development and source
├── backend/src/                TypeScript source
├── backend/dist/               Compiled output (gitignored)
├── frontend/src/               React source
├── frontend/dist/              Vite build output (gitignored)
└── deploy.sh                   Build, sync, migrate and restart

/opt/urbackup-gui/              Production
├── backend/dist/               Running backend
├── backend/.env                Secrets — preserved across updates
├── frontend/dist/              Static files served by nginx
└── version.json                Version manifest the update checker reads
```

---

`deploy.sh` builds both halves, syncs them into `/opt/urbackup-gui`, applies migrations, deploys
`version.json`, and restarts the service — failing loudly with logs if it does not come back.

---

## Uninstalling

This removes St0r. It does **not** touch UrBackup, its databases, or your backups.

```bash
sudo systemctl disable --now urbackup-gui
sudo rm /etc/systemd/system/urbackup-gui.service
sudo systemctl daemon-reload

sudo rm -f /etc/nginx/sites-enabled/urbackup-gui /etc/nginx/sites-available/urbackup-gui
sudo systemctl restart nginx

sudo rm -rf /opt/urbackup-gui
sudo mysql -u root -e "DROP DATABASE urbackup_gui; DROP USER 'urbackup'@'localhost';"
```

Two things the installer changed that this does not undo — reverse them by hand if you want to:

- Nginx's default site was deleted. Restore it with
  `sudo ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default`.
- The service user was added to the `urbackup` group and UrBackup's database files were made
  group-writable.

---

## Backing up St0r's own database

St0r's accounts, customers and replication configuration live in the `urbackup_gui` MariaDB database,
separately from UrBackup's own data. **Server Settings → Database Backup** creates a compressed dump into
`/opt/urbackup-gui/backups/`, and lists, restores or deletes existing ones. These are administrator-only
actions.

This is not a backup of UrBackup's databases or of your backup data. For those, see
[Backing up UrBackup's databases](URBACKUP_DATABASE_BACKUP.md) — worth reading before any maintenance that
touches `/var/urbackup`.

---

## Replication setup

1. **Replication → Targets → Add Target**.
2. Enter the standby server's host, SSH user and credentials. An SSH key is preferable to a password.
3. Set the target root path, and any repository path mappings.
4. **Test Connection** to verify SSH and rsync reachability.
5. **Replication → Settings** to enable replication and choose the trigger mode.
6. **Run Now** on a target starts an immediate run.

SSH credentials are encrypted with AES-256-GCM using a key derived from `APP_SECRET_KEY`.

Replication copies the backup store to another machine. It is not an independent verified restore, and it
does not make backups immutable — a deletion or corruption on the source replicates to the target.

---

## Troubleshooting

**Backend will not start**

```bash
sudo journalctl -u urbackup-gui -n 50
sudo ss -lptn 'sport = :3000'
mysql -u urbackup -p urbackup_gui -e "SELECT 1;"
```

A missing or weak `JWT_SECRET` stops the backend deliberately, with that reason in the log.

**File browser lists nothing**

The service user must be able to read UrBackup's storage tree. Confirm it is in the `urbackup` group
(`id "$USER"`) and that every directory above the backup folder is traversable.

**Backups will not start (`start_ok: false`)**

UrBackup rejected the request. The usual cause is internet file or image backups being disabled for that
endpoint — check **Endpoint Settings → Transfer** and **Image Backup**.

**Nginx problems**

```bash
sudo nginx -t
sudo tail -f /var/log/nginx/error.log
```

`Address already in use` or a `default_server` conflict usually means another site already owns port 80 —
see [Running behind an existing web server](#running-behind-an-existing-web-server).
