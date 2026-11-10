# Recovery verification

A backup that has never been restored is a hope. St0r's **Recovery Drills** restore real data from your
backups on a schedule, check it, and keep a record a customer can read. UrBackup stays the backup engine;
drills reuse St0r's scheduling, replication targets, alert channels and customer permissions.

There are two kinds of drill:

| Drill | What it proves | Needs |
|---|---|---|
| **File restore** | A known file can be restored, intact, from the **offsite copy** | A [replication target](installation.md#replication-setup) (a second UrBackup server St0r replicates to) |
| **Isolated boot** (optional) | A system image boots as a clone and its application service runs | A disposable Proxmox VE node, e.g. one managed with Depl0y |

Everything a drill creates is disposable and removed afterwards; production data, networks and VMs are
never touched.

## Three separate statuses

**Recovery Drills → Status** shows three things per endpoint. They are deliberately never combined:

- **Backup**: UrBackup's own view of the endpoint's last file and image backups.
- **Offsite replication**: whether the replication targets its drills use last replicated successfully.
- **Verified recovery**: the newest drill that *actually restored data*. A recovery point older than the
  drill's limit shows as *verified, old point*.

A successful backup or replication says nothing about whether the data can be restored. Only an actual
restore counts as verified recovery.

## File-restore drills

### 1. Register a canary

A canary is a file on the endpoint whose SHA-256 St0r stores in its own database, independently of
any backup. **Recovery Drills → Canaries**:

- **Generate a new file** (recommended). St0r creates random content, records its checksum and size,
  and downloads the file once. Copy it to the endpoint at the path you entered, for example
  `C/Users/Public/Documents/st0r-canary.bin` → `C:\Users\Public\Documents\st0r-canary.bin`. Make sure that
  folder is in the endpoint's backup paths. St0r does not keep the content, so its checksum cannot be
  "fixed" from a backup.
- **Register an existing file.** Enter its path inside the backup and the SHA-256 of a trusted original.
  Use a file that does not change; a changed file is reported as a failed restore.

The path is relative to the backup root, with `/` between folders, as in the file browser.

### 2. Create the drill

**Recovery Drills → Drills → New drill → File restore**. Choose the endpoint, the canary and the
**offsite copy** (a replication target), then a schedule (manual, every N hours, or a five-field cron
expression in server local time).

### What a run does

1. Connects to the replication target over SSH, with the same encrypted key and pinned host key that
   replication uses. If the target is unreachable, the run fails at **connect** (a missing standby).
2. Finds the client's backups on the standby: the storage folder is mapped through the target's
   repository path map (or its root path plus the replicated repository path), exactly where
   replication writes it.
3. Takes the newest complete backup whose canary has reached the standby. Replication can lag behind
   the newest local backup, so the run says which backups it skipped. A copy that resolves outside its
   backup folder (a symlink, for example) is ignored.
4. Copies the canary into disposable scratch storage, `run-<id>` under `STOR_DRILL_SCRATCH`
   (default `/tmp/st0r-drills`), and hashes the copy now on disk.
5. Compares the hash with the canary's recorded checksum. A mismatch fails the run at **verify**. It is
   not retried, and no older backup is tried instead, because a damaged offsite copy is the finding.
6. Deletes the scratch directory.

Each run records the exact copy (target, host, file path on the standby, last successful replication run),
the restore point (backup id, time, folder), the recovery point's age, the expected and actual checksums,
the bytes restored, the elapsed time, the number of attempts, each step, and why it failed if it did.

Limits: canaries up to 64 MiB, and the run checks scratch space before writing.

## Isolated boot drills (optional)

### The one supported combination

| | Supported |
|---|---|
| Endpoint | Windows x64 (10/11, Server 2016 or later), booting **UEFI from a GPT disk** |
| Backup | UrBackup **image backup of C:** plus the **EFI system partition** image from the same backup run (UrBackup takes both on UEFI machines), full or with incrementals |
| In the guest | **QEMU guest agent** installed and running (from the virtio-win guest tools) |
| Hypervisor | **Proxmox VE 8.4 or later**, a storage that allows the `import` content type, and a disk storage for VMs |
| Clone | OVMF (UEFI, no pre-enrolled Secure Boot keys), q35, the disk on SATA (Windows' built-in AHCI driver), guest agent on |
| Network | **No network device**, or one NIC on a bridge St0r has verified is isolated |

Not supported: BIOS/MBR systems, Linux, BitLocker-encrypted volumes, systems on several disks or with
dynamic disks, and data volumes other than C: (they are not attached). St0r refuses these when the run
starts.

The image is taken from St0r's own (primary) UrBackup storage. Offsite copies are checked by file drills.

### What a run does

1. Picks the newest restorable C: image and its ESP image, follows the incremental chain back to the full
   image, and checks that every file in the chain exists. A missing data file fails at **restore-point**.
2. Checks quotas before creating anything: the disk size against the hypervisor's *max disk* limit, the
   estimated scratch need against its *scratch quota* and the free space (including `/tmp` for
   decompression), and free space on both Proxmox storages.
3. Checks the isolated bridge, if one is set. It must be a bridge with **no ports and no host address,
   CIDR or gateway**; otherwise the run fails at **isolation** before anything is created.
4. Decompresses `.vhdz` images through St0r's root helper into `/tmp/st0r-vhd-<tag>`, then rebuilds the
   disk: the original MBR and GPT structures from UrBackup's `.mbr` data, then each volume on its
   partition. The result is sparse and is converted to qcow2 when `qemu-img` is installed.
5. Publishes the disk at a one-time URL (`/api/recovery/artifacts/<random token>/<file>`). Proxmox
   downloads it into the import storage and verifies its SHA-256. The URL is withdrawn as soon as the
   import ends.
6. Creates the clone `st0r-drill-<run>` with tags `st0r-drill` and `st0r-run-<run>`, starts it, and
   waits for the guest agent to answer (**boot**). Then it runs `sc.exe query <service>` through the
   agent until the service is `RUNNING` (**service**).
7. Records boot time and **recovery time** (from the start of the run until the service passed), then
   destroys the VM, deletes the imported volume, the scratch disk and the decompressed images.

### Proxmox setup

1. An isolated bridge, if the application needs a network interface to start. In
   `/etc/network/interfaces` on the node:

   ```
   auto vmbr9
   iface vmbr9 inet manual
       bridge-ports none
       bridge-stp off
       bridge-fd 0
   ```

   No `address`, no `gateway`, no ports. Or leave the bridge empty in St0r and the clone gets no NIC.
2. A storage that allows `import` content (**Datacenter → Storage → Edit → Content**), for example
   `local`.
3. A dedicated user and API token with only what drills need:

   ```
   pveum role add St0rDrill -privs "VM.Allocate VM.Config.Disk VM.Config.CPU VM.Config.Memory VM.Config.Network VM.Config.Options VM.Config.HWType VM.Audit VM.PowerMgmt VM.Monitor Datastore.AllocateSpace Datastore.AllocateTemplate Datastore.Audit Sys.Audit SDN.Use"
   pveum user add st0r-drill@pve
   pveum aclmod / -user st0r-drill@pve -role St0rDrill
   pveum user token add st0r-drill@pve st0r --privsep 0
   ```

   Privilege names change between Proxmox releases. On Proxmox VE 9 the guest agent needs the
   `VM.GuestAgent.*` privileges in place of `VM.Monitor`. Use **Test** in St0r to check.
4. In St0r: **Recovery Drills → Boot hypervisors → Add hypervisor**. Enter the API URL, the token id
   (`st0r-drill@pve!st0r`) and secret, the node, both storages, the bridge (optional), the **St0r address
   as Proxmox sees it** (where it downloads drill disks from, e.g. `https://st0r.lan`), and the SHA-256
   fingerprint of the node's certificate (`openssl x509 -in /etc/pve/local/pve-ssl.pem -noout
   -fingerprint -sha256` on the node) unless it has a CA-signed certificate. **Test** checks the API, both
   storages and the bridge without creating anything.

Depl0y users: this is the same Proxmox API Depl0y drives, so you can point St0r at a node Depl0y manages.
Keep drill VMs on a node or pool where nothing else runs.

### Simulator

A **Simulator** hypervisor runs a boot drill without a hypervisor: the disk is still rebuilt from the real
images, but no VM is created, and you choose whether the "boot" or the "service" fails. Use it to try the
procedure, alerts and reports. Simulator runs are recorded as **simulated**. They never count as verified
recovery, are listed separately in reports, and their alerts say so.

## Retries, timeouts, quotas and cleanup

- **Retries.** Errors that can be transient (a standby or hypervisor that cannot be reached, an import
  that failed) are retried up to the drill's *attempts* setting, with backoff. Everything the failed
  attempt created is cleaned up first. Verification, boot and service failures are not retried.
- **Timeout.** Each drill has an overall time limit. When it passes, the drill stops at its next step and
  is recorded as failed at **timeout**. Cleanup then runs with its own time limit.
- **Quotas.** The run checks every size limit and free-space figure listed above before it creates
  anything. A quota failure is recorded as **error**, not as a failed restore.
- **What is removed.** Each resource is recorded in St0r's database before it is created: scratch
  directories, decompression directories, the imported volume and the VM. Before deleting, cleanup checks
  that the resource is still the drill's: the VM's name and both tags, the volume's file name, and the
  directory's name and location. Anything else, for example a VM id that something else now uses, is left
  alone and recorded as *not ours*. Cleanup removes VMs first, then volumes, then local files.
- **Interrupted cleanup.** If cleanup fails, for example because Proxmox reports the storage busy, the run
  records *cleanup pending* and alerts. A sweeper retries every 10 minutes, up to 10 times, and then alerts
  that the resource has to be removed by hand (the run's detail lists it). A VM that was being created
  when a drill gave up is looked for on three more sweeps before it is written off, in case Proxmox
  finishes creating it late.
- **Restarts.** A run still in progress when St0r stops is marked **interrupted** at the next start, and
  everything it had created is cleaned up the same way.

One drill runs at a time per drill, and one boot drill at a time overall.

## Results and alerts

| Status | Meaning |
|---|---|
| passed | Restored and checked |
| failed | The restore did not work: no restore point, unreachable standby, damaged copy, no boot, service down, or a timeout |
| error | The drill could not run as configured: configuration, quota, network isolation, or St0r itself |
| interrupted | St0r stopped during the run |

Alerts use the channels in **Replication → Alerts** (email and webhook), with the same rate limit:

- `drill_failed` (critical): a run failed or could not run.
- `drill_recovered` (info): a drill passed again after a failure.
- `drill_rpo` (warning): the drill passed, but its recovery point is older than the drill's limit.
- `drill_cleanup`: cleanup did not finish (warning), or gave up and needs manual removal (critical).

## Customer report

**Status → Report** (or `/recovery/report/<endpoint>`) shows, for the last 7–365 days, what was actually
restored, from which copy, how old the recovery point was, how long the drill took, the checksum
comparison, boot time, recovery time and which services passed. Print it, or save it as PDF.
Simulations appear in a separate, clearly marked section and are not counted. The report leaves out
St0r's internal details: standby hosts and paths, and VM ids.

Customer accounts see statuses, drills, runs and reports for their own endpoints only, read-only.
Configuring drills, canaries and hypervisors is for administrators.

## Configuration

| Variable | Purpose |
|---|---|
| `STOR_DRILL_SCRATCH` | Scratch storage for drills (default `/tmp/st0r-drills`). For boot drills, point it at a filesystem with room for a full disk image |

Database: migration `009_recovery_drills.sql`, which updates apply automatically.
