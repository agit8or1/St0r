# Changelog

All notable changes to St0r (UrBackup GUI) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
