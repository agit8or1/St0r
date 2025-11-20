# UrBackup Server API - Complete Reference

**Base URL Format:** `http://server:55414/x?a={action}&{parameters}`

**Authentication:** HTTP Basic Auth OR session-based (ses= parameter)

## ⚠️ DATABASE SAFETY

**CRITICAL:** Always backup the database before making settings changes!
See: [URBACKUP_DATABASE_BACKUP.md](./URBACKUP_DATABASE_BACKUP.md)

---

## API Actions Reference

### Authentication & Session

| Action | Parameters | Description | HTTP Method |
|--------|-----------|-------------|-------------|
| `login` | username, password | Login and get session token | POST |
| `changepw` | old_password, new_password | Change user password | POST |
| `salt` | username | Get password salt for hashing | GET |

### Server Information

| Action | Parameters | Description | Returns |
|--------|-----------|-------------|---------|
| `status` | - | Get server and client status | JSON array of clients |
| `usage` | - | Get storage usage statistics | JSON with storage info |
| `progress` | - | Get current backup progress | JSON with progress data |
| `piegraph` | - | Get pie chart data | Image/JSON |
| `getbackupclients` | - | Get list of backup clients | Client array |

### Client Management

| Action | Parameters | Description |
|--------|-----------|-------------|
| `add_client` | clientname | Add new client |
| `remove_client` | clientid | Mark client for removal |
| `cancel_remove_client` | clientid | Cancel pending removal |
| `clientdl` | clientid | Download client installer |
| `download_client` | clientid, authkey, os, lang | Download preconfigured installer |

### Client Settings

| Action | Parameters | Description |
|--------|-----------|-------------|
| `clientsettings` | clientid, sa=clientsettings | Get client settings |
| `clientsettings_save` | clientid, key, newValue | Set client setting |
| `get_client_authkey` | clientid | Get client auth key |
| `reset_client_authkey` | clientid | Regenerate auth key |

**Available Client Settings Keys:**
```
- internet_mode_enabled (bool)
- internet_server (string)
- internet_server_port (number)
- internet_authkey (string)
- internet_image_backups (bool)
- internet_full_file_backups (bool)
- internet_encrypt (bool)
- internet_compress (bool)
- internet_connect_always (bool)
- internet_speed (number, -1 = unlimited)
- local_speed (number, -1 = unlimited)
- max_file_full (number, 0 = default)
- max_file_incr (number, 0 = default)
- max_image_full (number, 0 = default)
- max_image_incr (number, 0 = default)
- min_file_full (number, 0 = default)
- min_file_incr (number, 0 = default)
- min_image_full (number, 0 = default)
- min_image_incr (number, 0 = default)
- update_freq_incr (seconds)
- update_freq_full (seconds)
- update_freq_image_incr (seconds)
- update_freq_image_full (seconds)
- backup_window_incr_file (string)
- backup_window_full_file (string)
- backup_window_incr_image (string)
- backup_window_full_image (string)
- exclude_files (semicolon-separated paths)
- include_files (semicolon-separated paths)
- default_dirs (semicolon-separated paths)
- image_letters (comma-separated drive letters)
- allow_overwrite (bool)
- allow_pause (bool)
- allow_log_view (bool)
- allow_tray_exit (bool)
- allow_file_restore (bool)
- allow_config_paths (bool)
- allow_starting_full_file_backups (bool)
- allow_starting_incr_file_backups (bool)
- allow_starting_full_image_backups (bool)
- allow_starting_incr_image_backups (bool)
- image_file_format (vhd, vhdz, raw, cowfile)
- internet_calculate_filehashes_on_client (bool)
- internet_parallel_file_hashing (bool)
- internet_full_file_transfer_mode (raw, blockhash)
- internet_incr_file_transfer_mode (raw, blockhash)
- local_full_file_transfer_mode (raw, blockhash)
- local_incr_file_transfer_mode (raw, blockhash)
- internet_image_transfer_mode (raw, blockhash)
- local_image_transfer_mode (raw, blockhash)
- verify_using_client_hashes (bool)
- end_to_end_file_backup_verification (bool)
- silent_update (bool)
- client_quota (bytes)
- local_encrypt (bool)
- local_compress (bool)
- startup_backup_delay (seconds)
- background_backups (bool)
- alert_script (number, script ID)
- alert_params (object)
```

### Server Settings

| Action | Parameters | Description |
|--------|-----------|-------------|
| `general` | sa=general | Get general server settings |
| `general_save` | [settings] | Save general settings |
| `mail` | sa=mail | Get mail settings |
| `mail_save` | [settings] | Save mail settings |
| `ldap` | sa=ldap | Get LDAP settings |
| `ldap_save` | [settings] | Save LDAP settings |
| `internet` | sa=internet | Get internet mode settings |

**General Server Settings:**
```
- backupfolder (path to backup storage)
- autoshutdown (bool)
- download_client (bool)
- autoupdate_clients (bool)
- max_sim_backups (number)
- max_active_clients (number)
- cleanup_window (string)
- backup_database (bool)
- internet_server (string, FQDN for clients)
- internet_server_port (number)
- global_internet_speed (number)
- global_local_speed (number)
- use_tmpfiles (bool)
- tmpdir (path)
```

### Backup Operations

| Action | Parameters | Description |
|--------|-----------|-------------|
| `start_backup` | clientid, backup_type | Start backup (file/image, full/incr) |
| `start_full_file_backup` | clientname | Start full file backup |
| `start_incr_file_backup` | clientname | Start incremental file backup |
| `start_full_image_backup` | clientname | Start full image backup |
| `start_incr_image_backup` | clientname | Start incremental image backup |
| `stop_backup` | stopid | Stop running backup |

### Activities & Logs

| Action | Parameters | Description |
|--------|-----------|-------------|
| `activities` | - | Get current and past activities |
| `progress` | - | Get real-time backup progress |
| `lastacts` | - | Get last activities |
| `livelog` | clientid, logid | Stream live backup log |

### Backups & Files

| Action | Parameters | Description |
|--------|-----------|-------------|
| `backups` | clientid, sa=backups | Get client backup history |
| `files` | clientid, backupid, path | Browse backup files |
| `filesdl` | clientid, backupid, path | Download file from backup |
| `zipdl` | clientid, backupid, path | Download folder as ZIP |

### User & Group Management

| Action | Parameters | Description |
|--------|-----------|-------------|
| `listusers` | - | List all users |
| `useradd` | username, password, rights | Add new user |
| `removeuser` | username | Remove user |
| `updaterights` | username, rights | Update user permissions |
| `groupadd` | groupname | Add client group |
| `groupremove` | groupid | Remove client group |

### Alerts & Reports

| Action | Parameters | Description |
|--------|-----------|-------------|
| `get_alert` | - | Get alert configuration |
| `set_alert` | [config] | Set alert configuration |
| `rm_alert` | alertid | Remove alert |
| `get_report` | - | Get report configuration |
| `set_report` | [config] | Set report configuration |

---

## Response Formats

### Success Response
```json
{
  "success": true,
  "data": {...}
}
```

### Error Response
```json
{
  "error": "Error message here"
}
```

### Status Response
```json
{
  "status": [
    {
      "id": 1,
      "name": "ClientName",
      "ip": "192.168.1.100",
      "online": true,
      "lastbackup": "2024-01-01T00:00:00",
      "lastbackup_image": "2024-01-01T00:00:00",
      "bytes_used_files": 1234567890,
      "bytes_used_images": 9876543210,
      ...
    }
  ]
}
```

---

## Common Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ses` | string | Session token (from login) |
| `sa` | string | Sub-action for settings pages |
| `clientid` | number | Client identifier |
| `clientname` | string | Client name |
| `backupid` | number | Backup identifier |
| `path` | string | File path |
| `key` | string | Setting key name |
| `newValue` | string | New setting value |
| `lang` | string | Language code (en, de, etc.) |

---

## Example API Calls

### Login and Get Status
```bash
# Login
curl -X POST "http://server:55414/x?a=login" \
  -d "username=admin&password=yourpassword"
# Returns: {"success":true,"session":"abc123...","salt":"def456..."}

# Get Status (with session)
curl "http://server:55414/x?a=status&ses=abc123"
```

### Add Client
```bash
curl "http://server:55414/x?a=add_client&ses=abc123&clientname=NewClient"
```

### Get Client Settings
```bash
curl "http://server:55414/x?a=settings&sa=clientsettings&clientid=2&ses=abc123"
```

### Set Client Setting
```bash
curl -X POST "http://server:55414/x?a=settings&sa=clientsettings_save&ses=abc123" \
  -d "clientid=2&key=internet_mode_enabled&newValue=true"
```

### Start Full File Backup
```bash
curl "http://server:55414/x?a=start_full_file_backup&clientname=MyClient&ses=abc123"
```

### Download Preconfigured Installer
```bash
curl -O "http://server:55414/x?a=download_client&clientid=2&authkey=ABC123&os=windows&lang=en"
```

---

## Safety Guidelines

1. **Always backup database before modifying settings**
2. **Test API calls with read-only operations first**
3. **Use sessions instead of passing credentials repeatedly**
4. **Validate all input parameters**
5. **Check response success status**
6. **Handle errors gracefully**
7. **Never expose API endpoints publicly without authentication**
8. **Use HTTPS in production**
9. **Rotate session tokens regularly**
10. **Monitor for failed API calls**

---

## Implementation in St0r

St0r implements these API calls through:
- **Backend Service:** `/backend/src/services/urbackup.ts`
- **API Routes:** `/backend/src/routes/urbackup.ts`
- **urbackup-server-api:** npm package wrapper

---

## Further Reading

- [UrBackup Administration Manual](https://www.urbackup.org/administration_manual.html)
- [Node.js API Wrapper](https://github.com/bartmichu/node-urbackup-server-api)
- [Python API Wrapper](https://github.com/uroni/urbackup-server-python-web-api-wrapper)
- [UrBackup Forums](https://forums.urbackup.org/)
