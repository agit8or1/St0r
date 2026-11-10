import { Readable, Transform, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import * as zlib from 'zlib';
import type { FileHandle } from 'fs/promises';

/**
 * Minimal streaming ZIP writer (deflate, UTF-8 names, ZIP64 when needed).
 *
 * Folder downloads add files from handles that were already opened and vetted
 * (see openFileWithin), so nothing is re-opened by name after the check — which
 * is what handing a list of names to the `zip` command did.
 */

const ZIP64_LIMIT = 0xffffffff;
// Entries at least this large get ZIP64 local headers: deflate can expand
// incompressible data slightly, so stay well clear of the 4 GiB field limit.
const ZIP64_ENTRY_THRESHOLD = 0xf0000000;
const FLAGS = 0x0808; // bit 3: sizes in data descriptor; bit 11: UTF-8 names
const METHOD_DEFLATE = 8;
const VERSION_MADE_BY = (3 << 8) | 45; // Unix, spec 4.5
const EXTERNAL_ATTR = (0o100644 << 16) >>> 0; // regular file, rw-r--r--

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32Js(buf: Buffer, crc: number): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// zlib.crc32 exists from Node 20.15 / 22.2; fall back to the table otherwise.
const nativeCrc32 = (zlib as unknown as { crc32?: (d: Buffer, v: number) => number }).crc32;
const crc32 = (buf: Buffer, crc: number): number => (nativeCrc32 ? nativeCrc32(buf, crc) : crc32Js(buf, crc));

function dosDateTime(d: Date): { time: number; date: number } {
  const year = d.getFullYear();
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 }; // 1980-01-01
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.min(year, 2107) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

interface Entry {
  name: Buffer;
  offset: number;
  crc: number;
  compressed: number;
  size: number;
  time: number;
  date: number;
  zip64Local: boolean;
}

export class ZipWriter {
  private offset = 0;
  private readonly entries: Entry[] = [];

  /** `zip64Threshold` exists for tests; leave it at the default. */
  constructor(private readonly out: Writable, private readonly zip64Threshold = ZIP64_ENTRY_THRESHOLD) {}

  /** Number of entries added so far. */
  get count(): number {
    return this.entries.length;
  }

  private write(buf: Buffer): Promise<void> {
    this.offset += buf.length;
    if (this.out.destroyed || this.out.writableEnded) return Promise.reject(new Error('output closed'));
    if (this.out.write(buf)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onDrain = () => { cleanup(); resolve(); };
      const onClose = () => { cleanup(); reject(new Error('output closed')); };
      const cleanup = () => { this.out.off('drain', onDrain); this.out.off('close', onClose); };
      this.out.once('drain', onDrain);
      this.out.once('close', onClose);
    });
  }

  /**
   * Add one file, read from `handle` (at most `stats.size` bytes, from offset 0).
   * The handle is not closed here.
   */
  async addFile(name: string, handle: FileHandle, stats: { size: number; mtime: Date }): Promise<void> {
    const nameBuf = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
    if (nameBuf.length > 0xffff) throw new Error('file name too long for ZIP');
    const { time, date } = dosDateTime(stats.mtime);
    const zip64Local = stats.size >= this.zip64Threshold;
    const entry: Entry = { name: nameBuf, offset: this.offset, crc: 0, compressed: 0, size: 0, time, date, zip64Local };

    const extra = zip64Local ? Buffer.alloc(20) : Buffer.alloc(0);
    if (zip64Local) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(16, 2); // original and compressed size, filled in the descriptor
    }
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(zip64Local ? 45 : 20, 4);
    header.writeUInt16LE(FLAGS, 6);
    header.writeUInt16LE(METHOD_DEFLATE, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(0, 14);
    header.writeUInt32LE(zip64Local ? ZIP64_LIMIT : 0, 18);
    header.writeUInt32LE(zip64Local ? ZIP64_LIMIT : 0, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(extra.length, 28);
    await this.write(Buffer.concat([header, nameBuf, extra]));

    const source = stats.size > 0
      ? handle.createReadStream({ start: 0, end: stats.size - 1, autoClose: false })
      : Readable.from([]);
    const measure = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        entry.crc = crc32(chunk, entry.crc);
        entry.size += chunk.length;
        cb(null, chunk);
      },
    });
    const sink = new Writable({
      write: (chunk: Buffer, _enc, cb) => {
        entry.compressed += chunk.length;
        this.write(chunk).then(() => cb(), cb);
      },
    });
    await pipeline(source, measure, zlib.createDeflateRaw({ level: 6 }), sink);

    const descriptor = Buffer.alloc(zip64Local ? 24 : 16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(entry.crc, 4);
    if (zip64Local) {
      descriptor.writeBigUInt64LE(BigInt(entry.compressed), 8);
      descriptor.writeBigUInt64LE(BigInt(entry.size), 16);
    } else {
      descriptor.writeUInt32LE(entry.compressed, 8);
      descriptor.writeUInt32LE(entry.size, 12);
    }
    await this.write(descriptor);
    this.entries.push(entry);
  }

  /** Write the central directory and end the output stream. */
  async finish(): Promise<void> {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const big = { size: e.size >= ZIP64_LIMIT || e.zip64Local, comp: e.compressed >= ZIP64_LIMIT || e.zip64Local, off: e.offset >= ZIP64_LIMIT };
      const fields: bigint[] = [];
      if (big.size) fields.push(BigInt(e.size));
      if (big.comp) fields.push(BigInt(e.compressed));
      if (big.off) fields.push(BigInt(e.offset));
      const extra = Buffer.alloc(fields.length ? 4 + 8 * fields.length : 0);
      if (fields.length) {
        extra.writeUInt16LE(0x0001, 0);
        extra.writeUInt16LE(8 * fields.length, 2);
        fields.forEach((v, i) => extra.writeBigUInt64LE(v, 4 + 8 * i));
      }
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(VERSION_MADE_BY, 4);
      h.writeUInt16LE(fields.length ? 45 : 20, 6);
      h.writeUInt16LE(FLAGS, 8);
      h.writeUInt16LE(METHOD_DEFLATE, 10);
      h.writeUInt16LE(e.time, 12);
      h.writeUInt16LE(e.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(big.comp ? ZIP64_LIMIT : e.compressed, 20);
      h.writeUInt32LE(big.size ? ZIP64_LIMIT : e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt16LE(extra.length, 30);
      h.writeUInt16LE(0, 32); // comment
      h.writeUInt16LE(0, 34); // disk
      h.writeUInt16LE(0, 36); // internal attributes
      h.writeUInt32LE(EXTERNAL_ATTR, 38);
      h.writeUInt32LE(big.off ? ZIP64_LIMIT : e.offset, 42);
      await this.write(Buffer.concat([h, e.name, extra]));
    }
    const cdSize = this.offset - cdStart;
    const count = this.entries.length;

    if (count >= 0xffff || cdSize >= ZIP64_LIMIT || cdStart >= ZIP64_LIMIT) {
      const eocd64Offset = this.offset;
      const r = Buffer.alloc(56);
      r.writeUInt32LE(0x06064b50, 0);
      r.writeBigUInt64LE(44n, 4);
      r.writeUInt16LE(VERSION_MADE_BY, 12);
      r.writeUInt16LE(45, 14);
      r.writeUInt32LE(0, 16);
      r.writeUInt32LE(0, 20);
      r.writeBigUInt64LE(BigInt(count), 24);
      r.writeBigUInt64LE(BigInt(count), 32);
      r.writeBigUInt64LE(BigInt(cdSize), 40);
      r.writeBigUInt64LE(BigInt(cdStart), 48);
      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(0x07064b50, 0);
      loc.writeUInt32LE(0, 4);
      loc.writeBigUInt64LE(BigInt(eocd64Offset), 8);
      loc.writeUInt32LE(1, 16);
      await this.write(Buffer.concat([r, loc]));
    }

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(Math.min(count, 0xffff), 8);
    end.writeUInt16LE(Math.min(count, 0xffff), 10);
    end.writeUInt32LE(Math.min(cdSize, ZIP64_LIMIT), 12);
    end.writeUInt32LE(Math.min(cdStart, ZIP64_LIMIT), 16);
    end.writeUInt16LE(0, 20);
    await this.write(end);
    await new Promise<void>((resolve) => this.out.end(resolve));
  }
}
