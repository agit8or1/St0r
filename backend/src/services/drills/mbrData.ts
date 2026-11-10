/**
 * UrBackup's per-volume ".mbr" file (urbackupcommon/mbrdata.h, SMBRData):
 * which disk and partition an imaged volume came from, plus that disk's MBR
 * and, for GPT disks, its primary and backup GPT header and partition table —
 * what UrBackup's restore CD writes back before restoring the volume.
 *
 * Encoding (CRData): char, char version, int32 LE device_number, int32 LE
 * partition_number, then length-prefixed (uint32 LE) strings serial,
 * volume_name, fsn, mbr_data; version 1 (GPT) adds int64 LE positions with
 * strings for the GPT header, table, backup header and backup table.
 * Version 100 marks an image of a whole disk rather than one volume.
 */
export interface UrbackupMbr {
  version: number;
  wholeDisk: boolean;
  deviceNumber: number;
  partitionNumber: number;
  serial: string;
  volumeName: string;
  fsName: string;
  mbr: Buffer;
  gpt: null | {
    headerPos: number; header: Buffer;
    tablePos: number; table: Buffer;
    backupHeaderPos: number; backupHeader: Buffer;
    backupTablePos: number; backupTable: Buffer;
  };
}

export class MbrDataError extends Error {
  constructor(message: string) { super(message); this.name = 'MbrDataError'; }
}

class Reader {
  private pos = 0;
  constructor(private buf: Buffer) {}
  char(): number {
    if (this.pos + 1 > this.buf.length) throw new MbrDataError('truncated .mbr data');
    return this.buf.readInt8(this.pos++);
  }
  int(): number {
    if (this.pos + 4 > this.buf.length) throw new MbrDataError('truncated .mbr data');
    const v = this.buf.readInt32LE(this.pos); this.pos += 4; return v;
  }
  int64(): number {
    if (this.pos + 8 > this.buf.length) throw new MbrDataError('truncated .mbr data');
    const v = this.buf.readBigInt64LE(this.pos); this.pos += 8;
    if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -1n) throw new MbrDataError('position out of range in .mbr data');
    return Number(v);
  }
  bytes(): Buffer {
    if (this.pos + 4 > this.buf.length) throw new MbrDataError('truncated .mbr data');
    const len = this.buf.readUInt32LE(this.pos); this.pos += 4;
    if (len > 10 * 1024 * 1024 || this.pos + len > this.buf.length) throw new MbrDataError('bad string length in .mbr data');
    const b = this.buf.subarray(this.pos, this.pos + len); this.pos += len;
    return Buffer.from(b);
  }
}

export function parseUrbackupMbr(buf: Buffer): UrbackupMbr {
  const r = new Reader(buf);
  r.char();
  const version = r.char();
  if (version === 100) {
    return { version, wholeDisk: true, deviceNumber: -1, partitionNumber: -1, serial: '', volumeName: '', fsName: '', mbr: Buffer.alloc(0), gpt: null };
  }
  if (version !== 0 && version !== 1) throw new MbrDataError(`unsupported .mbr version ${version}`);
  const deviceNumber = r.int();
  const partitionNumber = r.int();
  const serial = r.bytes().toString('utf8');
  const volumeName = r.bytes().toString('utf8');
  const fsName = r.bytes().toString('utf8');
  const mbr = r.bytes();
  let gpt: UrbackupMbr['gpt'] = null;
  if (version === 1) {
    const headerPos = r.int64(); const header = r.bytes();
    const tablePos = r.int64(); const table = r.bytes();
    const backupHeaderPos = r.int64(); const backupHeader = r.bytes();
    const backupTablePos = r.int64(); const backupTable = r.bytes();
    gpt = { headerPos, header, tablePos, table, backupHeaderPos, backupHeader, backupTablePos, backupTable };
  }
  if (mbr.length < 512 || mbr.readUInt16LE(510) !== 0xaa55) throw new MbrDataError('no MBR boot signature in .mbr data');
  return { version, wholeDisk: false, deviceNumber, partitionNumber, serial, volumeName, fsName, mbr, gpt };
}

export interface Extent { offset: number; length: number }

export interface DiskLayout {
  sectorSize: number;
  /** Size of the disk to rebuild, in bytes. */
  size: number;
  style: 'gpt' | 'mbr';
  /** The volume's partition on that disk. */
  partition: Extent;
}

const GPT_SIGNATURE = 'EFI PART';

/** The original disk's geometry and where the imaged volume's partition lies on it. */
export function diskLayout(m: UrbackupMbr): DiskLayout {
  if (m.wholeDisk) throw new MbrDataError('whole-disk image: no partition layout');
  if (m.gpt) {
    const g = m.gpt;
    const sectorSize = g.headerPos; // the primary header is LBA 1
    if (![512, 4096].includes(sectorSize)) throw new MbrDataError(`unexpected GPT header position ${g.headerPos}`);
    if (g.header.length < 92 || g.header.toString('latin1', 0, 8) !== GPT_SIGNATURE) throw new MbrDataError('bad GPT header in .mbr data');
    const alternateLba = Number(g.header.readBigUInt64LE(32));
    const entries = g.header.readUInt32LE(80);
    const entrySize = g.header.readUInt32LE(84);
    if (entrySize < 128 || entrySize > 4096) throw new MbrDataError(`bad GPT entry size ${entrySize}`);
    const idx = m.partitionNumber - 1;
    if (idx < 0 || idx >= entries || (idx + 1) * entrySize > g.table.length) {
      throw new MbrDataError(`partition ${m.partitionNumber} is not in the GPT table`);
    }
    const e = g.table.subarray(idx * entrySize, (idx + 1) * entrySize);
    if (e.subarray(0, 16).every((b) => b === 0)) throw new MbrDataError(`GPT entry ${m.partitionNumber} is empty`);
    const first = Number(e.readBigUInt64LE(32));
    const last = Number(e.readBigUInt64LE(40));
    const size = (alternateLba + 1) * sectorSize;
    if (last < first || (last + 1) * sectorSize > size) throw new MbrDataError(`GPT entry ${m.partitionNumber} lies outside the disk`);
    return { sectorSize, size, style: 'gpt', partition: { offset: first * sectorSize, length: (last - first + 1) * sectorSize } };
  }
  // MBR: the four primary entries (logical partitions live in extended boot records not kept here).
  if (m.partitionNumber < 1 || m.partitionNumber > 4) {
    throw new MbrDataError(`partition ${m.partitionNumber} is a logical partition; only primary MBR partitions are supported`);
  }
  let end = 0;
  let partition: Extent | null = null;
  for (let i = 0; i < 4; i++) {
    const at = 446 + i * 16;
    const type = m.mbr[at + 4];
    const lba = m.mbr.readUInt32LE(at + 8);
    const count = m.mbr.readUInt32LE(at + 12);
    if (type === 0 || count === 0) continue;
    end = Math.max(end, (lba + count) * 512);
    if (i === m.partitionNumber - 1) partition = { offset: lba * 512, length: count * 512 };
  }
  if (!partition) throw new MbrDataError(`MBR entry ${m.partitionNumber} is empty`);
  const MiB = 1024 * 1024;
  return { sectorSize: 512, size: Math.ceil(end / MiB) * MiB + MiB, style: 'mbr', partition };
}

/** Bytes before the volume's data inside UrBackup's image file (server_channel.cpp, image download). */
export function volumeOffsetInImage(m: UrbackupMbr, imageVersion: number, isRaw: boolean): number {
  if (m.wholeDisk) return 0;
  if (imageVersion === 0 && !isRaw) return 512 * 512;
  return 1024 * 512;
}
