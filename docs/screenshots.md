# Screenshots

Every image is a real capture of the St0r interface at 1440×900, taken against a disposable demo
environment with fabricated endpoints, customers and file names. No production data appears in them.

Back to the [README](../README.md).

---

## Overview

### Dashboard

Estate summary: endpoint counts, backup job totals for the last seven days, replication health, server
resources, storage capacity, and any endpoints needing attention.

<img src="images/github/dashboard.png" alt="St0r dashboard showing six endpoints with five online, thirty-five successful and three failed backup jobs over seven days, healthy replication with two hour lag, backup storage capacity, and one endpoint listed as needing attention" width="100%">

### Endpoints

Every endpoint with its customer, last file and image backup, storage against an optional quota, IP
address and status. Filterable by state or customer.

<img src="images/github/endpoints.png" alt="Endpoint list showing six endpoints with customer assignment, last backup times, storage used against quota bars, IP addresses, and online or offline status badges" width="100%">

### Activities

Running and recent backup jobs, with progress and the ability to stop a running job.

<img src="images/github/activities.png" alt="Backup jobs screen listing recent backup activity with status and type filters" width="100%">

### Alerts

Endpoints whose backups are failing or overdue.

<img src="images/github/alerts.png" alt="Alerts screen listing endpoints with backup problems" width="100%">

---

## Endpoint management

### Endpoint detail

One endpoint's status, backup history and per-endpoint actions.

<img src="images/github/endpoint-detail.png" alt="Endpoint detail page showing status summary and backup history for a single endpoint" width="100%">

### Backup paths

Which folders are backed up, and whether the server or the client decides.

<img src="images/github/endpoint-paths.png" alt="Endpoint settings on the Backup Paths tab showing server-managed folder list and exclude patterns" width="100%">

### Schedule and retention

Incremental and full intervals, backup windows, and how many snapshots to keep.

<img src="images/github/endpoint-schedule.png" alt="Endpoint settings on the Schedule and Retention tab showing incremental and full backup intervals, backup windows, and file backup retention counts with UrBackup defaults noted" width="100%">

### Image backup

Image backup schedule and retention, and which volumes are imaged.

<img src="images/github/endpoint-image.png" alt="Endpoint settings on the Image Backup tab showing image schedule and retention options" width="100%">

### Storage limit

An optional per-endpoint quota with warning and critical thresholds.

<img src="images/github/endpoint-storage-limit.png" alt="Endpoint settings on the Storage Limit tab showing a per-endpoint quota with warning and critical thresholds" width="100%">

---

## Recovery

### File browser

Pick a date, open a backup from that day, and download individual files or folders.

<img src="images/github/file-browser.png" alt="File browser showing a September calendar with backup days highlighted, a selected backup, and the files inside one folder with download buttons" width="100%">

### Bare metal restore

Guidance for restoring a full system image, and export of an image backup as a VHD.

<img src="images/github/bare-metal-restore.png" alt="Bare metal restore page showing restore media instructions and a list of endpoints with restorable image backups" width="100%">

---

## Replication

Target health, replication lag, and the history of each run.

<img src="images/github/replication.png" alt="Replication overview showing one healthy target, two hour lag, and a table of four recent runs with status, trigger, duration and bytes sent" width="100%">

Replication copies the backup store to a standby machine. It is not a substitute for a tested restore,
and it does not make backups immutable.

---

## Administration

### Customers

Group endpoints under a customer, and scope read-only accounts to them.

<img src="images/github/customers.png" alt="Customers page listing three customers with their assigned endpoint and user counts" width="100%">

### Users

Administrator and read-only accounts. Read-only accounts can be limited to specific customers' endpoints.

<img src="images/github/users.png" alt="Users page listing accounts with their role and assigned customers" width="100%">

### Settings

Server-wide configuration: storage path, ports, internet client settings and backup defaults.

<img src="images/github/settings.png" alt="Settings page on the General tab showing backup storage path, server port, internet server name and port, and option toggles" width="100%">
