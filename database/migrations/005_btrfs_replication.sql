-- Migration 005: btrfs-aware replication mode per target
ALTER TABLE replication_targets
  ADD COLUMN btrfs_mode VARCHAR(20) NOT NULL DEFAULT 'auto'
    COMMENT 'auto=detect at runtime, btrfs_send=force btrfs send/receive, rsync=force rsync';
