# Changelog

All notable changes to St0r (UrBackup GUI) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
