// Disposable disk images for the recovery-drill tests: VHD writers (dynamic and
// differencing, per the Microsoft VHD spec), a GPT disk made by sgdisk, and
// UrBackup-style per-volume images (.vhd + .mbr) of it.
import { openSync, writeSync, closeSync, ftruncateSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const SECTOR = 512;

function checksum(buf, at) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) if (i < at || i >= at + 4) sum = (sum + buf[i]) >>> 0;
  return (~sum) >>> 0;
}

function footer(size, type, dataOffset) {
  const f = Buffer.alloc(SECTOR);
  f.write('conectix', 0, 'latin1');
  f.writeUInt32BE(2, 8);
  f.writeUInt32BE(0x00010000, 12);
  f.writeBigUInt64BE(dataOffset === null ? 0xffffffffffffffffn : BigInt(dataOffset), 16);
  f.write('qem2', 28, 'latin1'); // qemu then trusts current_size instead of CHS
  f.writeUInt32BE(0x00050003, 32);
  f.write('Wi2k', 36, 'latin1');
  f.writeBigUInt64BE(BigInt(size), 40);
  f.writeBigUInt64BE(BigInt(size), 48);
  // CHS (only informative here)
  const totalSectors = Math.min(size / SECTOR, 65535 * 16 * 255);
  const spt = 63, heads = 16;
  f.writeUInt16BE(Math.min(65535, Math.floor(totalSectors / (spt * heads))), 56);
  f[58] = heads; f[59] = spt;
  f.writeUInt32BE(type, 60);
  randomBytes(16).copy(f, 68);
  f.writeUInt32BE(checksum(f, 64), 64);
  return f;
}

/**
 * Write a dynamic (type 3) or differencing (type 4) VHD of `size` bytes with
 * `extents` ([{ offset, data }], sector-aligned) as its contents. Blocks not
 * touched by an extent stay unallocated.
 */
export function writeVhd(path, { size, type = 3, blockSize = 2 * 1024 * 1024, extents = [] }) {
  if (size % SECTOR) throw new Error('size must be sector-aligned');
  const entries = Math.ceil(size / blockSize);
  const sectorsPerBlock = blockSize / SECTOR;
  const bitmapBytes = Math.ceil(Math.ceil(sectorsPerBlock / 8) / SECTOR) * SECTOR;
  const tableOffset = SECTOR + 1024;
  const tableBytes = Math.ceil((entries * 4) / SECTOR) * SECTOR;
  const blocks = new Map(); // block -> { bitmap, data }
  for (const { offset, data } of extents) {
    if (offset % SECTOR || data.length % SECTOR) throw new Error('extents must be sector-aligned');
    for (let p = 0; p < data.length; p += SECTOR) {
      const abs = offset + p;
      const b = Math.floor(abs / blockSize);
      if (!blocks.has(b)) blocks.set(b, { bitmap: Buffer.alloc(bitmapBytes), data: Buffer.alloc(blockSize) });
      const blk = blocks.get(b);
      const s = (abs - b * blockSize) / SECTOR;
      data.copy(blk.data, s * SECTOR, p, p + SECTOR);
      blk.bitmap[s >> 3] |= 0x80 >> (s & 7);
    }
  }
  const dyn = Buffer.alloc(1024);
  dyn.write('cxsparse', 0, 'latin1');
  dyn.writeBigUInt64BE(0xffffffffffffffffn, 8);
  dyn.writeBigUInt64BE(BigInt(tableOffset), 16);
  dyn.writeUInt32BE(0x00010000, 24);
  dyn.writeUInt32BE(entries, 28);
  dyn.writeUInt32BE(blockSize, 32);
  if (type === 4) randomBytes(16).copy(dyn, 40); // parent uuid (not checked by St0r: the chain is explicit)
  dyn.writeUInt32BE(checksum(dyn, 36), 36);
  const bat = Buffer.alloc(tableBytes, 0xff);
  let next = tableOffset + tableBytes;
  const order = [...blocks.keys()].sort((a, b) => a - b);
  const placed = [];
  for (const b of order) {
    bat.writeUInt32BE(next / SECTOR, b * 4);
    placed.push([b, next]);
    next += bitmapBytes + blockSize;
  }
  const foot = footer(size, type, SECTOR);
  const fd = openSync(path, 'w');
  try {
    writeSync(fd, foot, 0, SECTOR, 0);
    writeSync(fd, dyn, 0, 1024, SECTOR);
    writeSync(fd, bat, 0, tableBytes, tableOffset);
    for (const [b, at] of placed) {
      const blk = blocks.get(b);
      // A dynamic disk's bitmap marks the whole block present.
      writeSync(fd, type === 3 ? Buffer.alloc(bitmapBytes, 0xff) : blk.bitmap, 0, bitmapBytes, at);
      writeSync(fd, blk.data, 0, blockSize, at + bitmapBytes);
    }
    writeSync(fd, foot, 0, SECTOR, next);
  } finally {
    closeSync(fd);
  }
}

/** Fill `n` bytes with a pattern that differs per sector and per seed. */
export function pattern(n, seed) {
  const b = Buffer.alloc(n);
  for (let s = 0; s < n / SECTOR; s++) {
    b.write(`${seed}:${s}:`.padEnd(64, '.'), s * SECTOR, 'latin1');
    b.fill((seed.charCodeAt(0) + s) & 0xff, s * SECTOR + 64, (s + 1) * SECTOR);
  }
  return b;
}

/** UrBackup's .mbr encoding (CRData): see backend/src/services/drills/mbrData.ts. */
export function encodeMbrData({ version = 1, deviceNumber = 0, partitionNumber, serial = 'TESTSERIAL', volumeName = '', fsName = 'NTFS', mbr, gpt }) {
  const parts = [];
  const ch = (v) => { const b = Buffer.alloc(1); b.writeInt8(v); parts.push(b); };
  const int = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); parts.push(b); };
  const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); parts.push(b); };
  const str = (s) => { const d = Buffer.isBuffer(s) ? s : Buffer.from(s); int(d.length); parts.push(d); };
  ch(1); ch(version);
  int(deviceNumber); int(partitionNumber);
  str(serial); str(volumeName); str(fsName); str(mbr);
  if (version === 1) {
    i64(gpt.headerPos); str(gpt.header);
    i64(gpt.tablePos); str(gpt.table);
    i64(gpt.backupHeaderPos); str(gpt.backupHeader);
    i64(gpt.backupTablePos); str(gpt.backupTable);
  }
  return Buffer.concat(parts);
}

/**
 * A 48 MiB GPT disk made by sgdisk: partition 1 = ESP (1–9 MiB), partition 2
 * = "C:" (9–47 MiB), both filled with distinct data. Returns the disk, its
 * partitions, and its MBR/GPT structures as UrBackup would record them.
 */
export function buildGptDisk(dir) {
  const MiB = 1024 * 1024;
  const size = 48 * MiB;
  const disk = join(dir, 'original.raw');
  const fd = openSync(disk, 'w'); ftruncateSync(fd, size); closeSync(fd);
  execFileSync('sgdisk', ['-n', '1:2048:18431', '-t', '1:ef00', '-c', '1:EFI', '-n', '2:18432:96255', '-t', '2:0700', '-c', '2:C', disk], { stdio: 'ignore' });
  const esp = { number: 1, offset: 2048 * SECTOR, length: (18431 - 2048 + 1) * SECTOR };
  const c = { number: 2, offset: 18432 * SECTOR, length: (96255 - 18432 + 1) * SECTOR };
  const buf = readFileSync(disk);
  // Some data, sparse: the start and end of each partition and a middle stripe.
  for (const [p, seed] of [[esp, 'esp'], [c, 'c']]) {
    for (const at of [0, Math.floor(p.length / 2 / MiB) * MiB, p.length - MiB]) {
      pattern(MiB, `${seed}${at}`).copy(buf, p.offset + at);
    }
  }
  writeFileSync(disk, buf);
  const gpt = {
    headerPos: 512, header: buf.subarray(512, 1024),
    tablePos: 1024, table: buf.subarray(1024, 1024 + 128 * 128),
    backupHeaderPos: size - 512, backupHeader: buf.subarray(size - 512, size),
    backupTablePos: size - 512 - 128 * 128, backupTable: buf.subarray(size - 512 - 128 * 128, size - 512),
  };
  return { disk, size, esp, c, mbr: Buffer.from(buf.subarray(0, 1024 * 512)), gpt, buf };
}

/** Bytes of a partition as UrBackup images it: 1024 sectors of header room, then the volume. */
export const IMAGE_SKIP = 1024 * 512;
