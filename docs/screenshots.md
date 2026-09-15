# Screenshot gallery

Every image is a real capture of the St0r interface at 1440 × 1000, taken against an isolated demo
environment. The endpoints, customers, IP addresses, file names and metrics are all **fabricated sample
data** — no production system or customer information appears anywhere in this gallery.

Each screenshot is labelled **Light** or **Dark**. Click any image to open the full-size original.

[← Back to the README](../README.md) · [Quick start](../README.md#quick-start) · [MSP Reboot](https://mspreboot.com)

---

## Contents

- [Overview and dashboards](#overview-and-dashboards)
- [Visual insights and monitoring](#visual-insights-and-monitoring)
- [Everyday workflows](#everyday-workflows)
- [Management and configuration](#management-and-configuration)
- [Access and administration](#access-and-administration)
- [How these were made](#how-these-were-made)

---

## Overview and dashboards

### Dashboard — Light

Endpoint counts, seven-day job totals, replication health, server resources, storage capacity, running
backups and anything needing attention, on one screen.

[![St0r dashboard in light theme: nine endpoints with eight online, fifty-six successful and three failed backup jobs over seven days, healthy replication with six hour lag, server CPU and memory gauges, a backup storage capacity ring, three running backups with progress, and one endpoint flagged as needing attention](images/github/dashboard-light.png)](images/github/dashboard-light.png)

### Dashboard — Dark

The same overview in the dark theme. Theme choice is per user and persists between sessions.

[![St0r dashboard in dark theme showing the same estate summary: endpoint counts, backup job totals, replication health, server resource gauges, storage capacity and running backups](images/github/dashboard-dark.png)](images/github/dashboard-dark.png)

### Endpoints — Light

Every endpoint with its customer, last file and image backup, storage against an optional quota, address
and status. Filter by state or by customer.

[![Endpoint list in light theme showing nine endpoints with customer assignment, last backup times, green quota usage bars, IP addresses and online status badges, with one offline endpoint whose last backup was four days ago](images/github/endpoints-light.png)](images/github/endpoints-light.png)

### Endpoints — Dark

The same list in dark, with the quota bars and status badges tuned for the dark palette.

[![Endpoint list in dark theme with customer assignment, last backup times, quota usage bars and status badges](images/github/endpoints-dark.png)](images/github/endpoints-dark.png)

---

## Visual insights and monitoring

### Running backups — Light

Live progress for every running job: percentage, data transferred, throughput and estimated time
remaining, with filters for state, type, endpoint and period.

[![Backup jobs screen in light theme showing three running backups with progress bars at sixty-four, twenty-eight and ninety-one percent, each with data transferred, speed in megabytes per second and estimated time remaining, above summary tiles for running, completed and errored jobs](images/github/activity-progress-light.png)](images/github/activity-progress-light.png)

### Alerts and notification rules — Light

Active alerts you can acknowledge or dismiss, and the rules that raise them — thresholds and delivery
channels per rule.

[![Alerts and notifications screen in light theme with one active client-offline warning, and four alert rules for backup failure, client offline, low storage and stale backups, each showing its threshold and delivery channel](images/github/alerts-light.png)](images/github/alerts-light.png)

### Reports — Light

Estate summary over a chosen period: totals, storage, backup timeline and success rate, exportable to CSV
or PDF.

[![Backup reports screen in light theme with report type and date filters, tiles for total clients, successful and failed backups, total storage used and average backup size, a backup timeline showing oldest and newest backup dates, and a success rate bar](images/github/reports-light.png)](images/github/reports-light.png)

### Replication overview — Light

Health across every target, worst replication lag, and the most recent runs.

[![Replication overview in light theme showing overall health, two of two targets healthy, worst lag of six hours, target cards for an offsite disaster recovery site and cold storage, and a table of recent runs](images/github/replication-overview-light.png)](images/github/replication-overview-light.png)

### Replication run history — Dark

Per-target history: status, trigger, duration and bytes sent for every run, including failures.

[![Replication target detail in dark theme showing last status, lag, last sync time and bytes sent, above a run history list of nine runs with one failed run among successful ones, each showing trigger, timestamp, duration and volume](images/github/replication-runs-dark.png)](images/github/replication-runs-dark.png)

### Storage protection — Dark

The disk guard: free space against warning, critical and pause thresholds, with manual reclaim and the
orphan prune. Backups pause before the volume can fill and resume once cleanup reclaims space.

[![Storage protection settings in dark theme showing disk guard status with warning, critical and emergency thresholds and the recorded events](images/github/disk-guard-dark.png)](images/github/disk-guard-dark.png)

---

## Everyday workflows

### Endpoint detail — Light

One endpoint's status, backup history and per-endpoint actions, with its pre-configured client installers.

[![Endpoint detail page in light theme showing online status, last seen time, pre-configured Windows, Linux and macOS client downloads, and the backup history for that endpoint](images/github/endpoint-detail-light.png)](images/github/endpoint-detail-light.png)

### File recovery — Light

Pick a day that has a backup, open it, and browse into the backup to download individual files or whole
folders.

[![File browser in light theme showing a September calendar with days that have backups highlighted, a selected backup, and the files inside one project folder with size, timestamp and download buttons](images/github/file-browser-light.png)](images/github/file-browser-light.png)

### Bare metal restore — Dark

Restore media and the step-by-step procedure for restoring a full system image to new hardware. The
endpoints with a restorable image are listed further down the page.

[![Bare metal restore page in dark theme showing the restore CD download, a USB imaging tool link, and five numbered restore steps ending with a warning that the target disk will be erased](images/github/bare-metal-restore-dark.png)](images/github/bare-metal-restore-dark.png)

---

## Management and configuration

### Schedule and retention — Light

Incremental and full intervals, backup windows, and how many snapshots to keep — per endpoint, with
UrBackup's defaults shown beside each field.

[![Endpoint settings on the schedule and retention tab in light theme, showing incremental and full backup intervals, backup windows, and file backup retention counts with UrBackup defaults noted under each field](images/github/schedule-retention-light.png)](images/github/schedule-retention-light.png)

### Storage quota — Light

An optional per-endpoint quota with warning and critical thresholds.

[![Endpoint settings on the storage limit tab in light theme showing a per-endpoint storage quota with warning and critical percentage thresholds](images/github/storage-limit-light.png)](images/github/storage-limit-light.png)

### Backup paths — Dark

Which folders are backed up, whether the server or the client decides, and the exclusion patterns.

[![Endpoint settings on the backup paths tab in dark theme showing server-managed folder list, a toggle for who controls the paths, and exclude patterns](images/github/backup-paths-dark.png)](images/github/backup-paths-dark.png)

### Image backup — Dark

Which volumes are imaged, and the Windows VSS writer components to include.

[![Endpoint settings on the image backup tab in dark theme showing the drive letters to image and toggles for VSS writer components including system state, Active Directory, Exchange, SQL Server and Hyper-V](images/github/image-backup-dark.png)](images/github/image-backup-dark.png)

### Transfer settings — Dark

Transfer mode, compression, encryption and bandwidth limits for this endpoint.

[![Endpoint settings on the transfer tab in dark theme showing transfer mode, compression, encryption and bandwidth limit options](images/github/transfer-settings-dark.png)](images/github/transfer-settings-dark.png)

### Backup defaults — Dark

Estate-wide defaults for new endpoints, including the retention floors that an out-of-space cleanup will
not delete below.

[![Server settings on the backup defaults tab in dark theme showing default maximum and minimum full and incremental backup counts, default intervals, and minimum ages before deletion](images/github/backup-defaults-dark.png)](images/github/backup-defaults-dark.png)

### Client configuration — Dark

The public hostname and port that generated client installers and agent install commands point at, plus
the CORS lock for the St0r API.

[![Settings on the client configuration tab in dark theme showing the server hostname and port used in generated installers, an explanation of how client deployment works, and a toggle to lock CORS to the configured hostname](images/github/client-config-dark.png)](images/github/client-config-dark.png)

### General settings — Dark

Storage path, ports, and the address internet clients connect to.

[![General settings in dark theme showing backup storage path, server port, maximum simultaneous backups, internet server name and port, and option toggles](images/github/settings-general-dark.png)](images/github/settings-general-dark.png)

### UrBackup server settings — Dark

UrBackup's own storage, performance and speed-limit settings, edited without leaving St0r.

[![UrBackup server settings in dark theme on the general settings tab, showing backup storage folder, temporary file options, maximum simultaneous backups and active clients, and speed limit settings](images/github/server-settings-dark.png)](images/github/server-settings-dark.png)

### Replication targets — Dark

Each configured standby with its host, current status, replication lag and last successful run, plus
per-target run, test and edit actions.

[![Replication targets tab in dark theme listing two standby targets with host and port, success status, replication lag, last successful run time, enabled state and per-target actions](images/github/replication-targets-dark.png)](images/github/replication-targets-dark.png)

---

## Access and administration

### Customers — Light

Group endpoints under a customer — expanded here to show the endpoints assigned to one. That assignment
is what scopes a read-only account's visibility.

[![Customers page in light theme with three customer cards, one expanded to list its four assigned endpoints with their online state and IP addresses](images/github/customers-light.png)](images/github/customers-light.png)

### Users and roles — Light

Administrator and read-only accounts. A read-only account sees only the endpoints of the customers it is
assigned to.

[![Users page in light theme listing accounts with their role, assigned customers, last login and status](images/github/users-light.png)](images/github/users-light.png)

### Endpoint permissions — Light

What the client may do locally: silent updates, background backups, exiting the tray icon, which manual
backups it can start, and whether it can restore.

[![Endpoint settings on the permissions tab in light theme showing client control toggles for silent update, background backups and tray exit, which manual backups the client may start, and restore permissions](images/github/permissions-light.png)](images/github/permissions-light.png)

---

## How these were made

Captured from an isolated demo environment — a separate database, a fabricated UrBackup database, and a
mock UrBackup API so the demo instance can never reach a real backup server. The tooling is in
[`scripts/demo/`](../scripts/demo/README.md) and each shot's route and theme are recorded in the capture
manifest, so the whole gallery can be regenerated reproducibly.

Themes are switched using the application's own theme selector and verified before each capture.

The Logs page is deliberately absent: it renders the host's `journalctl` output, which is real system data
even when the rest of the environment is demo data.

---

<div align="center">
<sub><a href="../README.md">← Back to the README</a> · <a href="https://mspreboot.com">MSP Reboot</a></sub>
</div>
