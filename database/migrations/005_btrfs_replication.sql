-- Migration 005: btrfs-aware replication mode per target
-- Safe to re-run (uses IF NOT EXISTS guards)
ALTER TABLE replication_targets
  ADD COLUMN IF NOT EXISTS btrfs_mode VARCHAR(20) NOT NULL DEFAULT 'auto'
    COMMENT 'auto=detect at runtime, btrfs_send=force btrfs send/receive, rsync=force rsync';
