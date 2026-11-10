import { open, FileHandle } from 'fs/promises';

/**
 * Read-only access to UrBackup image files: VHD (fixed, dynamic, differencing —
 * Microsoft "Virtual Hard Disk Image Format Specification") and raw images.
 *
 * An incremental image backup is a differencing VHD whose parent is the
 * previous image in the chain. The chain is passed in explicitly (from
 * UrBackup's backup_images.incremental_ref), never taken from the parent path
 * stored inside the file.
 */
export interface DiskImage {
  /** Virtual disk size in bytes. */
  readonly size: number;
  /** Read `length` bytes at virtual offset `offset` into a new buffer. */
  read(offset: number, length: number): Promise<Buffer>;
  /**
   * Byte ranges that may hold data, in order, coalesced. Everything outside
   * them reads as zeros, so a copy can skip them and stay sparse.
   */
  dataRanges(): Promise<Array<[number, number]>>;
  close(): Promise<void>;
}

export class ImageFormatError extends Error {
  constructor(message: string) { super(message); this.name = 'ImageFormatError'; }
}

const SECTOR = 512;
const UNALLOCATED = 0xffffffff;

const TYPE_FIXED = 2;
const TYPE_DYNAMIC = 3;
const TYPE_DIFFERENCING = 4;

function u64(buf: Buffer, at: number): number {
  const v = buf.readBigUInt64BE(at);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Number(v);
}

async function readExact(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await fh.read(buf, done, length - done, position + done);
    if (bytesRead === 0) break; // past EOF: the rest stays zero
    done += bytesRead;
  }
  return buf;
}

function coalesce(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = ranges.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** A raw (flat) image: virtual offset = file offset. */
export class RawImage implements DiskImage {
  private constructor(private fh: FileHandle, readonly size: number) {}

  static async open(path: string): Promise<RawImage> {
    const fh = await open(path, 'r');
    const st = await fh.stat();
    return new RawImage(fh, st.size);
  }

  read(offset: number, length: number): Promise<Buffer> {
    return readExact(this.fh, offset, Math.max(0, Math.min(length, this.size - offset)))
      .then((b) => (b.length === length ? b : Buffer.concat([b, Buffer.alloc(length - b.length)])));
  }

  async dataRanges(): Promise<Array<[number, number]>> {
    return this.size > 0 ? [[0, this.size]] : [];
  }

  close(): Promise<void> { return this.fh.close(); }
}

/** One VHD file, optionally on top of a parent (for a differencing disk). */
export class VhdImage implements DiskImage {
  readonly size: number;
  private blockSize = 0;
  private bitmapBytes = 0;
  private bat: Uint32Array = new Uint32Array(0);
  private fixed = false;
  private bitmapCache = new Map<number, Buffer>();

  private constructor(
    private fh: FileHandle,
    private footer: Buffer,
    readonly diskType: number,
    private parent: DiskImage | null,
  ) {
    this.size = u64(footer, 48);
  }

  /**
   * Open `path`. A differencing VHD needs `parent` (the previous image in the
   * chain); a fixed or dynamic one must not have one.
   */
  static async open(path: string, parent: DiskImage | null = null): Promise<VhdImage> {
    const fh = await open(path, 'r');
    try {
      const st = await fh.stat();
      if (st.size < SECTOR) throw new ImageFormatError(`${path}: too small to be a VHD`);
      // The footer is the last 512 bytes (511 for some old writers). Dynamic and
      // differencing disks also keep a copy at the start; prefer the end.
      let footer = await readExact(fh, st.size - SECTOR, SECTOR);
      if (footer.toString('latin1', 0, 8) !== 'conectix') {
        const alt = await readExact(fh, st.size - 511, 511);
        footer = Buffer.concat([alt, Buffer.alloc(1)]);
        if (footer.toString('latin1', 0, 8) !== 'conectix') {
          const head = await readExact(fh, 0, SECTOR);
          if (head.toString('latin1', 0, 8) !== 'conectix') throw new ImageFormatError(`${path}: no VHD footer`);
          footer = head;
        }
      }
      const type = footer.readUInt32BE(60);
      if (type !== TYPE_FIXED && type !== TYPE_DYNAMIC && type !== TYPE_DIFFERENCING) {
        throw new ImageFormatError(`${path}: unsupported VHD disk type ${type}`);
      }
      if (type === TYPE_DIFFERENCING && !parent) {
        throw new ImageFormatError(`${path}: differencing VHD needs its parent image`);
      }
      if (type !== TYPE_DIFFERENCING && parent) {
        throw new ImageFormatError(`${path}: a ${type === TYPE_FIXED ? 'fixed' : 'dynamic'} VHD has no parent`);
      }
      const img = new VhdImage(fh, footer, type, parent);
      if (parent && parent.size !== img.size) {
        throw new ImageFormatError(`${path}: size ${img.size} differs from its parent's ${parent.size}`);
      }
      if (type === TYPE_FIXED) {
        img.fixed = true;
      } else {
        await img.loadDynamicHeader(st.size, path);
      }
      return img;
    } catch (err) {
      await fh.close().catch(() => undefined);
      throw err;
    }
  }

  private async loadDynamicHeader(fileSize: number, path: string): Promise<void> {
    const headerOffset = u64(this.footer, 16);
    if (headerOffset + 1024 > fileSize) throw new ImageFormatError(`${path}: dynamic header outside the file`);
    const h = await readExact(this.fh, headerOffset, 1024);
    if (h.toString('latin1', 0, 8) !== 'cxsparse') throw new ImageFormatError(`${path}: no dynamic disk header`);
    const tableOffset = u64(h, 16);
    const entries = h.readUInt32BE(28);
    this.blockSize = h.readUInt32BE(32);
    if (this.blockSize < SECTOR || this.blockSize % SECTOR !== 0 || this.blockSize > 256 * 1024 * 1024) {
      throw new ImageFormatError(`${path}: invalid block size ${this.blockSize}`);
    }
    if (entries * this.blockSize < this.size) throw new ImageFormatError(`${path}: block table smaller than the disk`);
    const raw = await readExact(this.fh, tableOffset, entries * 4);
    this.bat = new Uint32Array(entries);
    for (let i = 0; i < entries; i++) this.bat[i] = raw.readUInt32BE(i * 4);
    const sectorsPerBlock = this.blockSize / SECTOR;
    this.bitmapBytes = Math.ceil(Math.ceil(sectorsPerBlock / 8) / SECTOR) * SECTOR;
  }

  private async bitmap(block: number): Promise<Buffer> {
    let b = this.bitmapCache.get(block);
    if (!b) {
      b = await readExact(this.fh, this.bat[block] * SECTOR, this.bitmapBytes);
      if (this.bitmapCache.size > 1024) this.bitmapCache.clear();
      this.bitmapCache.set(block, b);
    }
    return b;
  }

  async read(offset: number, length: number): Promise<Buffer> {
    const out = Buffer.alloc(length);
    if (offset >= this.size || length <= 0) return out;
    const end = Math.min(offset + length, this.size);
    if (this.fixed) {
      const b = await readExact(this.fh, offset, end - offset);
      b.copy(out, 0);
      return out;
    }
    let pos = offset;
    while (pos < end) {
      const block = Math.floor(pos / this.blockSize);
      const inBlock = pos - block * this.blockSize;
      const chunkEnd = Math.min(end, (block + 1) * this.blockSize);
      const sector = this.bat[block];
      if (sector === UNALLOCATED || sector === undefined) {
        if (this.parent) (await this.parent.read(pos, chunkEnd - pos)).copy(out, pos - offset);
        // else: zeros
      } else if (this.diskType === TYPE_DYNAMIC) {
        const dataStart = sector * SECTOR + this.bitmapBytes;
        (await readExact(this.fh, dataStart + inBlock, chunkEnd - pos)).copy(out, pos - offset);
      } else {
        // Differencing: per sector, our data where the bitmap says so, the parent's otherwise.
        const bm = await this.bitmap(block);
        const dataStart = sector * SECTOR + this.bitmapBytes;
        let s = Math.floor(inBlock / SECTOR);
        let p = pos;
        while (p < chunkEnd) {
          const mine = (bm[s >> 3] & (0x80 >> (s & 7))) !== 0;
          // extend the run while the bitmap bit stays the same
          let runEndSector = s + 1;
          while (block * this.blockSize + runEndSector * SECTOR < chunkEnd &&
                 ((bm[runEndSector >> 3] & (0x80 >> (runEndSector & 7))) !== 0) === mine) runEndSector++;
          const runEnd = Math.min(chunkEnd, block * this.blockSize + runEndSector * SECTOR);
          const data = mine
            ? await readExact(this.fh, dataStart + (p - block * this.blockSize), runEnd - p)
            : await this.parent!.read(p, runEnd - p);
          data.copy(out, p - offset);
          p = runEnd;
          s = runEndSector;
        }
      }
      pos = chunkEnd;
    }
    return out;
  }

  async dataRanges(): Promise<Array<[number, number]>> {
    if (this.fixed) return [[0, this.size]];
    const mine: Array<[number, number]> = [];
    for (let i = 0; i < this.bat.length; i++) {
      if (this.bat[i] !== UNALLOCATED) mine.push([i * this.blockSize, Math.min(this.size, (i + 1) * this.blockSize)]);
    }
    const parent = this.parent ? await this.parent.dataRanges() : [];
    return coalesce([...mine, ...parent]);
  }

  async close(): Promise<void> {
    await this.fh.close();
    if (this.parent) await this.parent.close();
  }
}

/**
 * Open an image chain, oldest (the full backup) first. Every element after the
 * first must be a differencing VHD on top of the previous one.
 */
export async function openImageChain(paths: string[]): Promise<DiskImage> {
  if (paths.length === 0) throw new ImageFormatError('empty image chain');
  let img: DiskImage | null = null;
  try {
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      if (/\.raw$/i.test(p)) {
        if (paths.length !== 1) throw new ImageFormatError(`${p}: raw images are not chained`);
        img = await RawImage.open(p);
      } else {
        img = await VhdImage.open(p, img);
      }
    }
    return img!;
  } catch (err) {
    if (img) await img.close().catch(() => undefined);
    throw err;
  }
}
