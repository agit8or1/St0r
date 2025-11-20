# st0r Utility Scripts

Utility scripts for managing st0r and UrBackup.

## backup-urbackup-database.sh

Backs up the UrBackup SQLite database with a timestamped filename.

### Usage

```bash
sudo ./backup-urbackup-database.sh
```

The script will:
- Locate the UrBackup database
- Create a timestamped backup copy
- Save it to `/var/urbackup/backups/` (or your configured backup directory)

### Notes

- Requires root/sudo access to read the UrBackup database
- Backup files are named: `backup_server.db.backup_YYYYMMDD_HHMMSS`
- Recommended to run this before performing any maintenance on your UrBackup server
