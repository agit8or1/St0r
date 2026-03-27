# Changelog

All notable changes to St0r (UrBackup GUI) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.2.88] - 2026-03-27

### Added
- **Servers page** (`/servers`): New page in the sidebar for managing this server and remote Linux servers from the UI. The local server is always present; remote servers can be added and managed.
- **stor-agent**: Lightweight Express.js management daemon (`agent/`) that runs on remote servers. Exposes a REST API (port 7420, API key auth) for metrics, OS updates, reboots, and St0r/UrBackup updates. Systemd service, auto-generates API key on first run.
- **Agent installation**: SSH-based auto-install pushes the agent to a remote server in one click. Alternatively, copy a `curl` command to run manually on the remote server, then paste the API key into St0r.
- **Per-server metrics**: CPU %, memory %, disk %, network throughput, uptime, hostname — fetched from `/proc` locally or via agent remotely. Auto-refreshes every 30 seconds.
- **Per-server operations**: Check OS updates (apt list --upgradable), apply OS updates, reboot — all from the server card. Remote servers also get St0r update and UrBackup update buttons.
- **Operation log viewer**: Live scrolling terminal log (same polling pattern as About page) for OS update and St0r update operations.
- **DB migration 006**: `managed_servers` table stores server config including encrypted SSH credentials and agent API keys.
- **Backend**: `services/agentClient.ts` (HTTP client), `services/serverSsh.ts` (SSH for install), `controllers/servers.ts`, `routes/servers.ts`, registered at `/api/servers`.

### Fixed
- **Settings page**: Removed "Automatic Backup Database Repair" checkbox (`autoshutdown` key). Testing confirmed UrBackup ignores this key in `general_save` — it always returns `false` regardless of what is saved. The label was also incorrect (`autoshutdown` means "shutdown after backup" in UrBackup, not database repair).
- **File Browser**: Replaced the flat backup card grid with a calendar date picker. Days with backups are highlighted with a colored dot. Clicking a day auto-selects single backups or shows a card picker for multiple backups on the same day.

## [3.2.87] - 2026-03-27

### Changed
- **Documentation page fully updated**: In-app Documentation page now reflects all current features. Features Overview expanded from 6 generic cards to 8 accurate cards covering real-time monitoring, client management with version display, storage limits, standby replication, security/2FA, one-click updates, advanced settings, and modern UI. Added dedicated sections for Replication (setup guide, trigger modes, alert channels), Security & Access Control (user roles, 2FA setup, security defaults), and Updates (St0r auto-update, UrBackup server update). Client list description now mentions version display and color-coded storage limit bars. Settings section expanded to cover SMTP/email, Pushover notifications, and internet client installer. Quick Reference updated: default password corrected to `admin123`, UrBackup internet port (55415) added to port list.

## [3.2.86] - 2026-03-27

### Removed
- **UrBackup Client Versions card removed from About page**: Client software versions are now shown directly on the Clients page under each endpoint name, making the About page dedicated to St0r update management only.

## [3.2.85] - 2026-03-27

### Added
- **UrBackup client version on Clients page**: Each endpoint now shows its UrBackup client software version string as small monospace text under the endpoint name. Data comes from the UrBackup status API; only visible for clients that have reported their version.

### Changed
- `Client` TypeScript interface extended with `client_version_string` and `os_simple` fields.
- `getClients()` now passes `client_version_string` through from the UrBackup status API merge.

## [3.2.84] - 2026-03-27

### Added
- **UrBackup server update management (About page)**: New card shows the installed UrBackup server version (from `dpkg`) vs the latest release on GitHub (`uroni/urbackup_backend`). When an update is available, an orange "Update UrBackup" button triggers an `apt-get install --only-upgrade urbackup-server` in the background via systemd-run, with a live terminal log and automatic service restart.
- **New backend endpoints**:
  - `GET /api/system-update/urbackup-version` — installed vs latest UrBackup server version
  - `POST /api/system-update/urbackup-update` — triggers apt-based UrBackup server upgrade
  - `GET /api/system-update/urbackup-update-log` — polls upgrade progress log
  - `GET /api/system-update/client-versions` — returns client version strings from UrBackup status API

## [3.2.83] - 2026-03-27

### Fixed
- **SMTP Server and Use SSL/TLS not saving in Settings → Email & Alerts**: The `getServerSettings` response merged settings from three sources (defaults, UrBackup API, direct SQLite read). The direct SQLite read was applied last with highest priority, and UrBackup's database contains default empty-string rows for all email fields. These empty rows silently overwrote values that had been saved through the UrBackup API on every page reload. Fixed by swapping the merge order so the UrBackup API response takes priority over the raw SQLite read. The FQDN (managed by St0r's `.env`) is re-pinned after both spreads to remain authoritative.

## [3.2.82] - 2026-03-22

### Fixed
- **Server outage: CORS blocked production domain**: The CORS allowlist added in v3.2.80 only included localhost variants. The production domain `https://stor.agit8or.net` was not included, causing 500 errors on every browser request. Reverted CORS to `origin: true` (reflect origin) with `credentials: true` — appropriate for a self-hosted internal tool where the auth layer is the actual security boundary.
- **Update-log route dropped**: `GET /api/system-update/update-log` was accidentally omitted when refactoring `system.ts` to use `router.use(authenticate)` at the top. The floating update window and About page update polling both returned 404. Route re-added.

## [3.2.81] - 2026-03-22

### Security
- **Update-log endpoint now requires authentication**: Previously unauthenticated; JWT is stateless so the HttpOnly cookie remains valid through service restarts.
- **CORS restricted to known origins**: `cors()` with no options allowed any origin. Now only allows `localhost:5173`, `localhost:3000`, and `FRONTEND_URL` env var. Unknown origins receive a 500 CORS error.
- **Token query-param restricted to download routes**: The `?token=` fallback in the auth middleware was available on all routes. Now only permitted on paths starting with `/download` (file download endpoint only).
- **2FA race condition fixed**: `setup2FA` previously overwrote the TOTP secret on every call, invalidating any QR code already being scanned. Now returns 400 if 2FA is already enabled — user must disable first before re-enrolling.
- **Fake backup codes removed**: 2FA backup codes were generated and shown to the user but never stored or validated — login would always reject them. Removed the misleading UI section and response field. The `backupCodes` response field is no longer returned.
- **Internal error details removed from API responses**: `message: error.message` was returned to authenticated clients in 12 error paths across 6 controllers, potentially leaking DB schema details, file paths, or stack traces. All replaced with `'An internal error occurred'` (full error still logged server-side).

## [3.2.80] - 2026-03-22

### Security
- **[Critical] SSH command injection**: `service_stop_cmd` / `service_start_cmd` on replication targets were embedded in SSH remote commands without validation. Now validated against an allowlist (`systemctl stop|start|restart|reload <unit>` or `service <unit> stop|start|restart`) before execution.
- **[Critical] `.env` file injection**: Admin-supplied settings values could contain newlines, injecting arbitrary keys (e.g. `JWT_SECRET`) into the `.env` file. Values are now stripped of `\r\n` before writing.
- **[Critical] SQLite `.backup` command injection**: Replication sqlite_path was user-controlled and embedded in a SQLite dot-command. Now validated to `[a-zA-Z0-9/_. -]+` and passed via `-cmd` flag instead of shell-interpolated argument.
- **[High] Path traversal in file browser**: `getFilesInBackup` had no containment check on the user-supplied `path` query parameter — `../../etc` would traverse outside the backup directory. Added the same `startsWith(backupBasePath)` guard that `downloadFile` had.
- **[High] Authorization bypass on user/customer/storage routes**: `POST /api/users`, `PUT /api/users/:id`, `DELETE /api/users/:id`, all customer mutation routes, and storage limit mutations only required `authenticate`, not admin. Any authenticated user could create admins, delete accounts, or modify customer records. Added `requireAdmin` to all mutating routes.
- **[High] JWT token in response body**: Login response returned `token` in JSON body in addition to setting it as an HttpOnly cookie, defeating XSS protection. Removed from response body.
- **[High] Insecure backup code generation**: 2FA backup codes used `Math.random()` (not cryptographically secure). Now uses `crypto.randomBytes(5).toString('hex')`.
- **[Medium] HTML injection in bug report emails**: User-supplied fields were interpolated into the HTML email template unescaped. All fields now passed through an HTML-escaping function.
- **[Medium] Unbounded replication query limit**: `getRuns` accepted arbitrary `limit` values. Now capped at 500, minimum 1, non-numeric values default to 50.
- **[Medium] Synchronous file copy blocks event loop**: `fs.copyFileSync` on multi-GB VHD files blocked all requests during copy. Changed to `fs.promises.copyFile`.
- **[Medium] Recursive `pump()` without await**: `clientInstaller.ts` called `pump()` without `await`, building an unbounded call stack on large files. Added `await`.
- **[Medium] Inactive users returned by getAllUsers**: `getAllUsers()` returned all rows including `is_active = FALSE`. Added `WHERE is_active = TRUE`.
- **[Medium] Content-Disposition filename injection**: Download filename used `filename="..."` which breaks on filenames containing `"`. Changed to RFC 5987 `filename*=UTF-8''...` encoding.
- **[Low] StrictHostKeyChecking=no**: SSH connections without a known-hosts fingerprint used `no`, which accepts any host key (MITM risk). Changed to `accept-new` (trust on first connect, reject changes).
- **[Low] Self-deletion / last-admin deletion**: Admins could delete their own account or the last admin account, locking everyone out. `removeUser` now rejects both cases.
- **[Low] Weak JWT secret warning**: Added startup warning if `JWT_SECRET` is unset or equals the insecure default value.

## [3.2.79] - 2026-03-22

### Fixed
- **Endpoints page empty on some installs**: UrBackup may store `delete_pending` as `NULL` rather than `0` for active clients (observed on root installs). All SQL queries used `WHERE delete_pending = 0` which, per SQLite semantics, excludes `NULL` rows. Changed to `(delete_pending = 0 OR delete_pending IS NULL)` across all 10 affected queries. Clients that were visible in UrBackup's own UI but invisible in St0r's Endpoints page will now appear correctly.

## [3.2.78] - 2026-03-22

### Fixed
- **"Completed Today" showing last 24h instead of current day**: The date filter for "today" used `diffDays < 1` (rolling 24-hour window) instead of comparing against midnight. Now uses `ms >= todayMidnight` so the count resets at 00:00 like you'd expect. The "Errors Today" stat tile uses the same fix. The "Today" tab filter for the history table is also corrected.
- **Auto-update false-completes instantly**: The update-log endpoint kept the log from the previous run on disk. When a new update was triggered, the first poll (within ~1s) read the stale log which already contained "SUCCESS", causing the frontend to show "Update complete!" and reload before anything had actually run. Fixed by: (1) the backend now truncates the log file synchronously before firing the update script, and (2) the frontend now requires seeing `inProgress=true` at least once before acting on a SUCCESS/FAILED state (using a `useRef` to avoid stale closures).

## [3.2.77] - 2026-03-22

### Fixed
- **Storage dashboard error on non-administrator installs**: Backup storage path was hardcoded to `/home/administrator/urbackup-storage` in two places. It now reads the actual path from UrBackup's `backup_server_settings.db` (`backupfolder` key), falling back to `/var/urbackup` if unset. The `URBACKUP_BACKUP_PATH` env var can still override it. Fixes `df: /home/administrator/urbackup-storage: No such file or directory` errors on servers where the install user isn't `administrator`.

## [3.2.76] - 2026-03-21

### Fixed
- **Fresh install missing replication tables**: The installer only ran `database/init/01_schema.sql` on new installs, skipping all migrations. Any feature added via a migration (replication, managed mode tables) was absent, causing 500 errors (`Table 'urbackup_gui.replication_settings' doesn't exist`) that broke the endpoints page and other views. The installer now also runs all migration files on fresh installs.

## [3.2.75] - 2026-03-14

### Fixed
- **Backup history showing all backups as "Full"**: UrBackup's `incremental` column is not a 0/1 flag — it uses 0 for full and 1, 2, 3... (incrementing counter) for incrementals. The Activities/backup-history query used `=== 1` (only matched level 1) instead of `!== 0` (matches any incremental level). Only the very first incremental after a full was correctly labelled; all subsequent ones appeared as "Full".

## [3.2.74] - 2026-03-12

### Added
- **btrfs-aware replication**: Replication now correctly handles btrfs-based UrBackup storage
  - Auto-detects whether backup storage is on btrfs at run time (`findmnt -o FSTYPE`)
  - If btrfs detected: uses `btrfs send | ssh btrfs receive` instead of rsync, preserving all snapshot parent/child relationships and deduplication on the target
  - Incremental sends: each subvolume's btrfs parent is tracked — if the parent is already on the target, an incremental send (`btrfs send -p`) is used instead of a full send
  - Already-received subvolumes are skipped on subsequent runs (idempotent)
  - Falls back gracefully: if no subvolumes found (e.g. empty dir), reverts to rsync for that path; individual subvolume failures are logged but don't abort the run
  - Per-target **Storage Transfer Mode** selector in the target modal:
    - **Auto-detect** (default): btrfs send/receive if source is btrfs, rsync otherwise
    - **Force btrfs send/receive**: for when you know the storage is btrfs
    - **Force rsync**: bypass detection and always use rsync
  - `btrfs-progs` must be installed on both source and target servers when using btrfs mode
  - Setup instructions updated to mention btrfs-progs requirement

## [3.2.73] - 2026-03-10

### Fixed
- **Stale image_ok status after backup deletion**: UrBackup leaves `image_ok=1` in the DB after you manually delete all image backups (it only recalculates on the next backup run). `image_ok` is now overridden to `false` when live backup count is 0, so the client correctly shows no image backup status instead of a stale OK.

## [3.2.72] - 2026-03-10

### Added
- **Download backup**: Each backup row has a Download button — fetches the `.sql.gz` file directly to the browser
- **Restore from existing backup**: Restore button per row shows a warning confirm dialog before overwriting the database
- **Upload & Restore**: File picker at the bottom of the Configuration Backup tab — upload a `.sql` or `.sql.gz` file from your computer to restore; uploaded file is also saved to the backup list

## [3.2.71] - 2026-03-10

### Fixed
- **Configuration Backup completely broken**: Frontend was calling non-existent API endpoints (`/database-backup/:id`, `/database-backup/:id/restore`, expected `{id,name,createdBy}` response) while backend uses a file-based MySQL dump system with different routes/format — nothing worked at all
- **Backup creation required manual name entry**: Now auto-named with `YYYY-MM-DD_HH-MM-SS` timestamp, single-click create

### Added
- **Delete backup**: Trash button per backup row triggers an inline confirm dialog before deleting the `.sql.gz` file
- **Backup list shows**: human-readable date/time, filename, compressed size, and age

## [3.2.70] - 2026-03-10

### Fixed
- **Server Settings page layout broken**: Page was missing the `Layout` wrapper, causing the sidebar, nav menu, and CSS to disappear when visiting `/server-settings` directly

### Added
- **Storage by Customer tab** on Server Settings page: Shows backup storage usage (file + image backups) aggregated per customer, with a progress bar and percentage of total. Unassigned clients grouped separately.

## [3.2.69] - 2026-03-09

### Fixed
- **Backup deletion hanging**: `rm -rf` on large backups was blocking the HTTP response for minutes, making it appear the delete had failed. The DB `delete_pending=1` flag is now set synchronously (backup disappears from the list instantly), then `rm -rf` runs in the background without blocking.

## [3.2.68] - 2026-03-09

### Fixed
- **Backup deletion broken**: Backend was correctly deleting files but the UI never updated — caused by `Backup.id` being typed as `string` while the API returns `number`, making comparisons silently fail. Fixed type, now reloads backup list from server after every delete.

### Added
- **Multi-select backups**: Checkbox on each backup row + Select All. When any are checked a "Delete N selected" button appears that bulk-deletes them sequentially.

## [3.2.67] - 2026-03-09

### Added
- **Dashboard — Successful Backups tile**: New green stat card showing count of successful backup jobs in the last 7 days, linking to Activities filtered by successful
- **Dashboard — Backup Jobs (7d) summary card**: Replaces the Backup Types bar chart with a clean numeric card showing Successful / Failed / Total job counts for the past 7 days
- **Activities page redesign**: Unified backup job list replacing the old multi-section layout
  - Single filterable table showing all backup jobs with Client, Customer, Date/Time, Type, Duration, Size, and Issues columns
  - Status filter tabs: All / Running / Successful / Errors
  - Type filter: All / File / Image
  - Client dropdown filter
  - Date range tabs: Today (default) / Last 7 Days / Last 30 Days / All Time
  - Running jobs shown as rich progress cards with speed, ETA, and cancel button
  - Click any completed job row to expand inline log entries
  - Customer column sourced from MariaDB customers/customer\_clients tables
- **Backend `/api/urbackup/backup-stats`**: New endpoint returning successful/failed/total job counts for a configurable number of days

### Fixed
- Dashboard backup stats (Successful/Failed counts) now load on initial render — no more `—` placeholder on page load
- Failed Backups tile now shows job-level count from backup-stats API (consistent with Successful tile)
- Report Bug button now opens GitHub Issues directly (`https://github.com/agit8or1/St0r/issues/new`) instead of the custom in-app modal

## [3.2.23] - 2026-03-04

### Added
- **Full Standby Replication** — Mirror UrBackup to one or more DR targets via SSH/rsync
  - Replication dashboard with Overview, Targets, Settings, and Alerts tabs
  - Per-target test connection (SSH ping + rsync dry-run)
  - Run history with step-by-step log viewer per target
  - AES-256-GCM encrypted storage of SSH private keys and passwords
  - Hook-based and schedule-based triggers with configurable debounce
  - Email and webhook alert channels for failures, staleness, and recovery
- **Replication health card** on Dashboard (shows overall status, healthy target count, worst lag)
- **Clickable Dashboard stat cards** — Total Endpoints → /clients, Active Tasks → /activities, Storage → /server-settings, etc.

### Fixed
- Settings pipeline — UrBackup boolean settings now sent as `1`/`0` not `true`/`false`
- Client endpoint settings now show correct effective values (resolves group vs. client override confusion)
- Global settings (getSettings/setSettings) correctly flatten the UrBackup API response
- Backup trigger now surfaces `start_ok=false` as a clear inline error message instead of silently failing
- Backup buttons use inline React notification instead of browser `alert()`
- ServerSettings save/restore use inline confirm dialogs instead of `window.confirm()`
- FileBrowser restore uses inline confirm dialog instead of `window.confirm()`
- `ClientManagementModal` — all 11 `alert()`/`confirm()` calls replaced with inline state modals
- `Replication` page — all `alert()` calls replaced with inline notification banner
- SQL injection mitigation: FQDN validated with strict hostname regex before any DB write
- Client settings persistence: `getClientSettings` now returns `v.value` (effective resolved value) instead of `v.value_group`
- Image backups in Activities now grouped by session — 3-partition backup shows as one entry ("Image Backup (C:, D:, System Reserved)")

## [3.2.22] - 2026-02-xx

### Fixed
- Settings persistence across page reloads
- Compact endpoints and dashboard UI layout improvements
- UrBackup API no-password login uses GET (not POST with `plainpw=1`)
- Update UI uses inline confirm state instead of `window.confirm()`
- Reconnecting state surfaced to user; errors shown inline

## [3.2.18] - 2026-01-xx

### Fixed
- Windows installer embeds correct server FQDN from settings
- `.env` file permissions set correctly on production install
- Settings sync between GUI and UrBackup `backup_server_settings.db`
- Settings defaults applied correctly on first run
- Production systemd service path fixes
- `npm audit` high-severity vulnerabilities patched

## [3.2.5] - 2025-12-08

### Fixed
- **Critical**: Fixed stale/stuck jobs showing in Running Backups section
  - Jobs with -1% progress (failed/crashed) are now automatically filtered out
  - Jobs marked as complete no longer appear in running activities
  - Real-time filtering prevents stale jobs from displaying in UI
- Fixed Activities page "Completed" counter to respect date range filters
  - Counter now shows accurate count based on selected filter (Today, Last 7 Days, Last 30 Days, All Time)
- Fixed `[object Object]` errors in Client Backup Schedule settings
  - Improved error message handling to always display readable strings
  - Added proper type checking for error objects before display

### Added
- **Automatic Stale Job Cleanup**: Background process runs every hour
  - Initial cleanup runs 5 minutes after server start
  - Automatically stops and removes jobs with negative progress
  - Prevents accumulation of zombie/stale backup jobs
  - Logged activity visible in server logs
- **Manual "Clear Stale Jobs" Button**: Added to Activities page
  - Orange button in page header for on-demand cleanup
  - Shows confirmation dialog before clearing
  - Displays count of jobs found and cleared
  - Immediately refreshes activities list after cleanup

### Changed
- Enhanced Activities page with better stale job management
- Improved error handling across all frontend components
- Better logging for stale job detection and cleanup operations

## [3.2.4] - 2025-11-20

### Fixed
- **Critical**: Fixed 2FA setup and verification
  - Increased database column `totp_secret` size from 32 to 100 characters
  - Fixed user ID field name mismatch (`.id` → `.userId`)
  - Fixed 2FA issuer name to display "St0r GUI" instead of "UrBackup GUI"
- Fixed NaNmin display in backup durations (now shows "N/A" for missing data)
- Improved 2FA error handling with detailed logging
- **Website Screenshots**: Replaced incorrect placeholder screenshots with actual St0r interface
  - Screenshot 2 now correctly shows Client Management with File & Image backup status indicators
  - All screenshots now display proper St0r backup management interface
  - Removed unrelated AI Filter and Email Washing Machine screenshots

### Added
- **2FA Login Enforcement**: Users with 2FA enabled are now prompted for code during login
  - Beautiful UI prompt with shield icon
  - Auto-focus on 2FA input
  - Back button to return to login if needed

### Changed
- Enhanced 2FA verification flow with better error messages
- Login page now handles 2FA requirement gracefully
- Updated project website with carousel/lightbox screenshot viewer (similar to Depl0y project page)
- Improved screenshot captions to better describe file and image level backup features
- Enhanced website presentation at https://agit8or.net/projects/stor.html

## [3.2.3] - 2025-11-20

### Fixed
- About page no longer crashes when API calls fail
- Added null/undefined checks for activeInstalls display
- Fixed favicon.ico 404 error (added floppy disk emoji favicon)
- About page now gracefully handles expired JWT tokens

### Added
- Database migration script for existing installations (`database/migrations/add_installations_table.sql`)
- Emoji favicon (💾 floppy disk) for browser tab

### Changed
- Improved error handling in About page component
- Better defensive programming for API responses

## [3.2.2] - 2025-11-20

### Fixed
- **Critical**: Added missing `installations` table to database schema
  - Fixes 500 errors on version tracking endpoints
  - Resolves About page blank/crash issues
  - Installer now creates all required database tables
- Fixed vite.svg 404 error (removed reference from index.html)
- Fixed version.json not being included in deployment package
- About page now handles API failures gracefully

### Changed
- Updated database schema to include installations tracking table
- Improved installer to ensure all database tables are created
- Enhanced error handling in version API endpoints

## [3.2.1] - 2025-11-20

### Fixed
- **Critical**: Fixed installer UrBackup Server download failure
  - Changed from broken download URL to Ubuntu PPA installation method
  - Now uses `ppa:uroni/urbackup` for reliable installation
  - Added OS detection for Ubuntu/Debian systems
- **Critical**: Fixed deployment package structure
  - Package now extracts to correct `urbackup-gui/` directory
  - Resolved "Package extraction failed" error
  - Deployment package now includes proper directory hierarchy
- Updated installer to use correct deployment package URL (v3.2.1)

### Changed
- Improved installer error messages for unsupported distributions
- Enhanced deployment package structure for remote installations

## [3.2.0] - 2025-11-20

### Added
- **File Browser**: Browse and download files from any backup
  - Navigate through folders in backups
  - Download individual files
  - Multi-select files for restore
  - Works with both file and image backups
- **File Restore from Web**: Restore multiple files directly to client from web interface
  - Select files/folders with checkboxes
  - Restore to original locations
  - Confirmation dialogs for safety
- **Bare Metal Restore Page**: New dedicated page for system recovery
  - Download UrBackup Restore CD/USB ISO
  - Link to Rufus USB creation tool
  - Step-by-step restore instructions
  - List of all clients with image backups
  - Display backup IDs needed for restore
- Improved deployment script with automatic build and deploy

### Fixed
- **Critical**: Fixed timestamp calculation showing backups "55830 years in the future"
  - Backend: Added proper handling for NULL/invalid timestamps
  - Frontend: Returns "Never" for invalid dates instead of nonsensical values
  - Fixed date parsing for SQLite DATE fields
- **Critical**: Fixed backup history showing 0 backups
  - Fixed NULL handling in delete_pending column (was filtering out all backups)
  - Fixed incremental detection (changed from === 1 to !== 0 for proper level detection)
- **Critical**: Fixed file browsing showing "no files"
  - Corrected path construction: /backupfolder/clientname/backuppath/
  - Added proper backup folder detection from /var/urbackup/backupfolder
  - Fixed security check path validation
- Fixed backup type display (now correctly shows 2 Full + 4 Incremental instead of 5 Full + 1 Incremental)
- Fixed download security check blocking all file downloads (403 Forbidden)

### Changed
- Updated deployment process to properly sync files to /opt/urbackup-gui
- Improved error handling and logging throughout file browsing system

### Technical Notes
- File browsing reads directly from backup storage directories
- Downloads stream files with authentication
- Restore operations integrate with UrBackup's native restore API
- All file operations include security checks to prevent directory traversal

## [3.1.0] - 2025-11-17

### Added
- **Real-time backup progress tracking** via UrBackup server's progress API
  - Shows live transfer speed (MB/s)
  - Displays estimated time remaining (ETA)
  - Tracks bytes transferred vs total bytes
  - Shows current operation details
  - Includes indexing phase (not just file transfer)
- **Storage pie chart** on dashboard showing used vs available backup storage
- Action type mapping for all backup operations (Indexing, Full/Incremental file/image backups, Hashing, etc.)

### Fixed
- **Critical timestamp bug** - Timestamps were displaying "in about 55824 years" due to double multiplication by 1000
  - Backend was already returning milliseconds, but frontend was multiplying by 1000 again
  - Fixed `formatTimestamp()` and `formatTimeAgo()` functions in `frontend/src/utils/format.ts`
  - Now correctly displays: "6 hours ago", "2 hours ago", etc.
- **Client status showing "Unknown"** instead of "OK"
  - Frontend expected numeric status codes (0-12) but backend returned strings ("ok", "offline", "failed")
  - Updated `getClientStatusText()` and `getClientStatusColor()` to handle both formats
  - Status now correctly displays with proper color coding (green for OK, yellow for failed, gray for offline)
- **Duplicate activities in progress** - Two entries showing for same backup
  - Progress API process ID was different from database backup ID
  - Changed merge logic to match by `clientid + type` instead of `clientid + id`
  - Now shows single merged activity with real-time progress data
- **SQLite datetime parsing** - Backend now properly parses TEXT datetime fields from UrBackup database
  - Added helper function to handle both Unix timestamps and ISO 8601 datetime strings
  - Fixes `lastseen`, `lastbackup`, and `lastbackup_image` fields

### Changed
- Enhanced activity tracking to merge database records with real-time progress API data
- Improved storage display layout with larger pie chart and better legend
- Updated client status determination logic to properly handle different backup configurations

### Technical Details
- Backend: `/home/administrator/urbackup-gui/backend/src/services/urbackup.ts`
  - Added `getActionString()` method to map numeric action codes to readable strings
  - Modified `getCurrentActivities()` to fetch from progress API and merge with DB
  - Fixed `formatClient()` to parse SQLite TEXT datetime fields
  - Updated `getClientStatus()` to handle TEXT timestamps
- Frontend: `/home/administrator/urbackup-gui/frontend/src/utils/format.ts`
  - Removed double multiplication by 1000 in timestamp formatting
- Frontend: `/home/administrator/urbackup-gui/frontend/src/utils/status.ts`
  - Added string status handling ("ok", "offline", "failed")
- Frontend: `/home/administrator/urbackup-gui/frontend/src/pages/Dashboard.tsx`
  - Added storage pie chart with donut style and percentage labels

## [3.0.0] - 2025-11-15

### Added
- Initial release of St0r - Modern UrBackup GUI
- React-based frontend with Vite
- Node.js/Express backend with TypeScript
- Dashboard with backup statistics and charts
- Client management interface
- Activity monitoring
- Settings management
- MariaDB backend for user authentication and settings
- Direct SQLite access to UrBackup database for read operations
- UrBackup API integration for write operations (start/stop backups)

### Security
- JWT-based authentication
- bcrypt password hashing
- Role-based access control
- Helmet.js security headers
- Rate limiting on API endpoints
