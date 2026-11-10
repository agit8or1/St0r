import { open } from 'fs/promises';
import { DiskImage } from './vhd.js';
import { UrbackupMbr, diskLayout, MbrDataError } from './mbrData.js';

/**
 * Rebuild a bootable disk from UrBackup's per-volume images, the way its
 * restore CD does: write the original disk's MBR and GPT structures (from the
 * volume's .mbr data), then copy each volume onto its partition. The result
 * is a sparse raw disk file; ranges with no data are never written.
 */
export interface VolumeSource {
  /** e.g. "C:" or "ESP" — for messages. */
  letter: string;
  mbr: UrbackupMbr;
  image: DiskImage;
  /** Bytes before the volume's data inside the image (see volumeOffsetInImage). */
  skip: number;
}

export interface AssembleResult {
  size: number;
  bytesWritten: number;
  partitions: Array<{ letter: string; offset: number; length: number; partitionNumber: number }>;
}

const CHUNK = 4 * 1024 * 1024;

function isZero(b: Buffer): boolean {
  for (let i = 0; i < b.length; i += 8) {
    if (i + 8 <= b.length) { if (b.readBigUInt64LE(i) !== 0n) return false; }
    else { for (let j = i; j < b.length; j++) if (b[j] !== 0) return false; }
  }
  return true;
}

function sameLayout(a: UrbackupMbr, b: UrbackupMbr): boolean {
  if (a.serial !== b.serial || a.deviceNumber !== b.deviceNumber) return false;
  if (!!a.gpt !== !!b.gpt) return false;
  if (a.gpt && b.gpt) return a.gpt.table.equals(b.gpt.table) && a.gpt.header.subarray(0, 92).equals(b.gpt.header.subarray(0, 92));
  return a.mbr.subarray(446, 510).equals(b.mbr.subarray(446, 510));
}

export async function assembleDisk(
  outPath: string,
  volumes: VolumeSource[],
  opts: { maxSize?: number; onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<AssembleResult> {
  if (volumes.length === 0) throw new MbrDataError('no volumes to assemble');
  if (volumes.some((v) => v.mbr.wholeDisk)) {
    throw new MbrDataError('a whole-disk image is booted as it is, not assembled');
  }
  const base = volumes[0].mbr;
  for (const v of volumes.slice(1)) {
    if (!sameLayout(base, v.mbr)) {
      throw new MbrDataError(`${v.letter} comes from a different disk (or partition table) than ${volumes[0].letter}`);
    }
  }
  const layouts = volumes.map((v) => ({ v, l: diskLayout(v.mbr) }));
  const size = layouts[0].l.size;
  if (opts.maxSize && size > opts.maxSize) {
    throw new MbrDataError(`disk is ${size} bytes, over the ${opts.maxSize}-byte limit for this drill`);
  }
  // Partitions must not overlap each other or the GPT structures.
  const sorted = [...layouts].sort((a, b) => a.l.partition.offset - b.l.partition.offset);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].l.partition;
    if (sorted[i].l.partition.offset < prev.offset + prev.length) throw new MbrDataError('volumes overlap on the disk');
  }

  const total = layouts.reduce((n, { l }) => n + l.partition.length, 0);
  let done = 0;
  let written = 0;
  const fh = await open(outPath, 'wx', 0o640);
  try {
    await fh.truncate(size);
    const put = async (pos: number, data: Buffer) => {
      if (pos < 0 || pos + data.length > size) throw new MbrDataError('partition table data lies outside the disk');
      await fh.write(data, 0, data.length, pos);
    };
    // All of the saved MBR area (it may carry boot code past sector 0), then the
    // GPT structures over it — the order UrBackup's restore uses.
    await put(0, base.mbr);
    if (base.gpt) {
      const g = base.gpt;
      await put(g.headerPos, g.header);
      await put(g.tablePos, g.table);
      if (g.backupHeaderPos >= 0) await put(g.backupHeaderPos, g.backupHeader);
      if (g.backupTablePos >= 0) await put(g.backupTablePos, g.backupTable);
    }

    for (const { v, l } of layouts) {
      const { offset, length } = l.partition;
      const avail = Math.max(0, v.image.size - v.skip);
      if (avail < length) {
        throw new MbrDataError(`${v.letter}: the image holds ${avail} bytes but its partition is ${length}`);
      }
      // Only ranges that can hold data, mapped from image space to partition space.
      for (const [a, b] of await v.image.dataRanges()) {
        const from = Math.max(a, v.skip);
        const to = Math.min(b, v.skip + length);
        for (let p = from; p < to; p += CHUNK) {
          if (opts.signal?.aborted) throw new Error('aborted');
          const n = Math.min(CHUNK, to - p);
          const data = await v.image.read(p, n);
          if (!isZero(data)) {
            await fh.write(data, 0, n, offset + (p - v.skip));
            written += n;
          }
          done += n;
          opts.onProgress?.(done, total);
        }
      }
    }
    await fh.sync();
  } catch (err) {
    await fh.close().catch(() => undefined);
    throw err;
  }
  await fh.close();
  return {
    size,
    bytesWritten: written,
    partitions: layouts.map(({ v, l }) => ({ letter: v.letter, offset: l.partition.offset, length: l.partition.length, partitionNumber: v.mbr.partitionNumber })),
  };
}
