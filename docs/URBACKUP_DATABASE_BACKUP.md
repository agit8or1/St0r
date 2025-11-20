# UrBackup Server Database Backup Guide

## CRITICAL: Database Corruption Prevention

UrBackup database corruption can cause complete data loss. **ALWAYS backup before making changes.**

## Database Files Location

**Linux:** `/var/urbackup/`
**Windows:** `C:\Program Files\UrBackupServer\urbackup\`

### Database Files:
- `backup_server.db` - Main server database
- `backup_server_settings.db` - Server settings
- `backup_server_files.db` - File backup metadata
- `backup_server_links.db` - Deduplication links
- `backup_server_link_journal.db` - Link journal
- `*.db-shm` - Shared memory files
- `*.db-wal` - Write-ahead log files

## Automatic Backups

UrBackup creates **nightly automatic backups** in the same directory with timestamps.

## Manual Backup Procedure

### On UrBackup Server (192.168.22.251)

Run this script as root:

```bash
#!/bin/bash
# UrBackup Database Backup Script

BACKUP_DIR="/var/urbackup"
BACKUP_DEST="/root/urbackup-db-backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="urbackup-db-backup-${TIMESTAMP}"

# Create backup directory
mkdir -p "${BACKUP_DEST}"

echo "Stopping UrBackup Server..."
systemctl stop urbackupsrv

echo "Backing up databases..."
mkdir -p "${BACKUP_DEST}/${BACKUP_NAME}"

# Copy all database files
cp -v "${BACKUP_DIR}/backup_server.db" "${BACKUP_DEST}/${BACKUP_NAME}/" 2>&1
cp -v "${BACKUP_DIR}/backup_server_settings.db" "${BACKUP_DEST}/${BACKUP_NAME}/" 2>&1
cp -v "${BACKUP_DIR}/backup_server_files.db" "${BACKUP_DEST}/${BACKUP_NAME}/" 2>&1
cp -v "${BACKUP_DIR}/backup_server_links.db" "${BACKUP_DEST}/${BACKUP_NAME}/" 2>&1
cp -v "${BACKUP_DIR}/backup_server_link_journal.db" "${BACKUP_DEST}/${BACKUP_NAME}/" 2>&1

# Create tarball
cd "${BACKUP_DEST}"
tar -czf "${BACKUP_NAME}.tar.gz" "${BACKUP_NAME}"
rm -rf "${BACKUP_NAME}"

echo "Starting UrBackup Server..."
systemctl start urbackupsrv

echo ""
echo "Backup complete: ${BACKUP_DEST}/${BACKUP_NAME}.tar.gz"
echo "Size: $(du -h ${BACKUP_DEST}/${BACKUP_NAME}.tar.gz | cut -f1)"
```

## Database Repair

If corruption occurs:

```bash
# Stop server
systemctl stop urbackupsrv

# Run repair
urbackupsrv repair-database

# Start server
systemctl start urbackupsrv
```

## Restore from Backup

```bash
# Stop server
systemctl stop urbackupsrv

# Remove corrupted databases
cd /var/urbackup
rm -f backup_server.db backup_server.db-shm backup_server.db-wal
rm -f backup_server_settings.db backup_server_settings.db-shm backup_server_settings.db-wal
rm -f backup_server_files.db backup_server_files.db-shm backup_server_files.db-wal
rm -f backup_server_links.db backup_server_links.db-shm backup_server_links.db-wal
rm -f backup_server_link_journal.db backup_server_link_journal.db-shm backup_server_link_journal.db-wal

# Restore from backup
tar -xzf /root/urbackup-db-backups/urbackup-db-backup-TIMESTAMP.tar.gz
cp urbackup-db-backup-TIMESTAMP/*.db .

# Start server
systemctl start urbackupsrv
```

## Prevention Tips

1. **Never use symbolic links** for the database directory (causes corruption)
2. Use `mount --bind` instead if you need to relocate
3. Ensure adequate disk space
4. Regular backups before any configuration changes
5. Monitor system logs for SQLite errors
