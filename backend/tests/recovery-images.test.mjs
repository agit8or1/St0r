// npm run build && node --test tests/recovery-images.test.mjs
// The boot drill's image handling: St0r's VHD reader against qemu-img, UrBackup
// .mbr parsing, and rebuilding a GPT disk (made by sgdisk) from per-volume
// images — full and incremental — byte for byte.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeVhd, pattern, encodeMbrData, buildGptDisk, IMAGE_SKIP } from './fixtures/drill-images.mjs';

const { VhdImage, openImageChain } = await import('../dist/services/drills/vhd.js');
const { parseUrbackupMbr, diskLayout, volumeOffsetInImage, MbrDataError } = await import('../dist/services/drills/mbrData.js');
const { assembleDisk } = await import('../dist/services/drills/diskAssembler.js');

const dir = mkdtempSync(join(tmpdir(), 'stor-images-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const have = (cmd) => { try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } };

async function readAll(img) {
  return img.read(0, img.size);
}

test('dynamic VHD: St0r reads what qemu-img reads', { skip: !have('qemu-img') && 'qemu-img not installed' }, async () => {
  const size = 9 * 1024 * 1024;
  const vhd = join(dir, 'dyn.vhd');
  writeVhd(vhd, { size, extents: [{ offset: 0, data: pattern(4096, 'a') }, { offset: 5 * 1024 * 1024 + 512, data: pattern(1024 * 1024, 'b') }] });
  const raw = join(dir, 'dyn.qemu.raw');
  execFileSync('qemu-img', ['convert', '-f', 'vpc', '-O', 'raw', vhd, raw]);
  const img = await VhdImage.open(vhd);
  try {
    assert.equal(img.size, size);
    assert.equal(sha(await readAll(img)), sha(readFileSync(raw)));
    // Blocks 1 and 3 hold nothing: they are not offered as data.
    const ranges = await img.dataRanges();
    assert.deepEqual(ranges, [[0, 2 * 1024 * 1024], [4 * 1024 * 1024, 8 * 1024 * 1024]]);
  } finally { await img.close(); }
});

test('qemu-img-written VHD is read the same way', { skip: !have('qemu-img') && 'qemu-img not installed' }, async () => {
  const raw = join(dir, 'src.raw');
  const data = Buffer.concat([pattern(3 * 1024 * 1024, 'q'), Buffer.alloc(2 * 1024 * 1024), pattern(1024 * 1024, 'r')]);
  writeFileSync(raw, data);
  const vhd = join(dir, 'qemu.vhd');
  execFileSync('qemu-img', ['convert', '-f', 'raw', '-O', 'vpc', '-o', 'subformat=dynamic,force_size=on', raw, vhd]);
  const img = await VhdImage.open(vhd);
  try {
    assert.equal(img.size, data.length);
    assert.equal(sha(await readAll(img)), sha(data));
  } finally { await img.close(); }
});

test('differencing VHD chain: newest sectors win, the rest come from the parent', async () => {
  const size = 4 * 1024 * 1024;
  const full = join(dir, 'full.vhd');
  const inc1 = join(dir, 'inc1.vhd');
  const inc2 = join(dir, 'inc2.vhd');
  const base = pattern(size, 'base');
  writeVhd(full, { size, extents: [{ offset: 0, data: base }] });
  const a = pattern(1536, 'inc1');
  const b = pattern(512, 'inc2');
  writeVhd(inc1, { size, type: 4, extents: [{ offset: 1024, data: a }] });
  writeVhd(inc2, { size, type: 4, extents: [{ offset: 1536, data: b }, { offset: 3 * 1024 * 1024, data: b }] });
  const expected = Buffer.from(base);
  a.copy(expected, 1024);
  b.copy(expected, 1536);
  b.copy(expected, 3 * 1024 * 1024);
  const img = await openImageChain([full, inc1, inc2]);
  try {
    assert.equal(sha(await readAll(img)), sha(expected));
    // Unaligned reads across the boundaries too.
    assert.deepEqual(await img.read(1000, 2000), expected.subarray(1000, 3000));
  } finally { await img.close(); }
  // A differencing image is never opened on its own.
  await assert.rejects(openImageChain([inc1]), /needs its parent/);
});

test('a damaged VHD is refused, not read as zeros', async () => {
  const p = join(dir, 'bad.vhd');
  writeVhd(p, { size: 1024 * 1024, extents: [{ offset: 0, data: pattern(512, 'x') }] });
  const buf = readFileSync(p);
  buf.write('garbage!', 512, 'latin1'); // the dynamic header cookie
  buf.write('garbage!', buf.length - 512, 'latin1'); // the footer
  buf.write('garbage!', 0, 'latin1'); // and its copy
  writeFileSync(p, buf);
  await assert.rejects(VhdImage.open(p), /no VHD footer/);
});

test('UrBackup .mbr data parses into the original GPT layout', { skip: !have('sgdisk') && 'sgdisk not installed' }, () => {
  const g = buildGptDisk(mkdtempSync(join(dir, 'gpt-')));
  const m = parseUrbackupMbr(encodeMbrData({ partitionNumber: 2, mbr: g.mbr, gpt: g.gpt, volumeName: 'C:' }));
  assert.equal(m.partitionNumber, 2);
  const l = diskLayout(m);
  assert.equal(l.style, 'gpt');
  assert.equal(l.size, g.size);
  assert.deepEqual(l.partition, { offset: g.c.offset, length: g.c.length });
  assert.equal(volumeOffsetInImage(m, 1, false), IMAGE_SKIP);
  // An empty slot, truncated data and a missing boot signature are errors.
  assert.throws(() => diskLayout(parseUrbackupMbr(encodeMbrData({ partitionNumber: 5, mbr: g.mbr, gpt: g.gpt }))), /empty/);
  assert.throws(() => parseUrbackupMbr(encodeMbrData({ partitionNumber: 2, mbr: g.mbr, gpt: g.gpt }).subarray(0, 100)), MbrDataError);
  assert.throws(() => parseUrbackupMbr(encodeMbrData({ partitionNumber: 2, mbr: Buffer.alloc(512), gpt: g.gpt })), /boot signature/);
});

test('ESP + C: (full, then incremental) rebuild the sgdisk disk byte for byte', { skip: (!have('sgdisk') || !have('qemu-img')) && 'sgdisk/qemu-img not installed' }, async () => {
  const d = mkdtempSync(join(dir, 'assemble-'));
  const g = buildGptDisk(d);
  const vol = (p) => g.buf.subarray(p.offset, p.offset + p.length);
  const mbrFor = (n) => parseUrbackupMbr(encodeMbrData({ partitionNumber: n, mbr: g.mbr, gpt: g.gpt }));
  const imgSize = IMAGE_SKIP + g.c.length;

  // The full C: image holds an older state; the incremental brings it up to the disk's.
  const older = Buffer.from(vol(g.c));
  pattern(64 * 1024, 'stale').copy(older, 3 * 1024 * 1024);
  const espVhd = join(d, 'Image_ESP.vhd');
  const cFull = join(d, 'Image_C_full.vhd');
  const cInc = join(d, 'Image_C_inc.vhd');
  writeVhd(espVhd, { size: IMAGE_SKIP + g.esp.length, extents: [{ offset: IMAGE_SKIP, data: Buffer.from(vol(g.esp)) }] });
  writeVhd(cFull, { size: imgSize, extents: [{ offset: IMAGE_SKIP, data: older }] });
  writeVhd(cInc, { size: imgSize, type: 4, extents: [{ offset: IMAGE_SKIP + 3 * 1024 * 1024, data: Buffer.from(vol(g.c).subarray(3 * 1024 * 1024, 3 * 1024 * 1024 + 64 * 1024)) }] });

  const esp = await openImageChain([espVhd]);
  const c = await openImageChain([cFull, cInc]);
  const out = join(d, 'rebuilt.raw');
  const r = await assembleDisk(out, [
    { letter: 'ESP', mbr: mbrFor(1), image: esp, skip: IMAGE_SKIP },
    { letter: 'C:', mbr: mbrFor(2), image: c, skip: IMAGE_SKIP },
  ]);
  await esp.close(); await c.close();
  assert.equal(r.size, g.size);
  assert.equal(sha(readFileSync(out)), sha(g.buf), 'the rebuilt disk is the original');
  // sgdisk agrees the table is intact (it verifies headers, CRCs and the backup copy).
  assert.match(execFileSync('sgdisk', ['-v', out], { encoding: 'utf-8' }), /No problems found/);
  // The rebuilt disk stays sparse: unwritten areas are holes.
  assert.ok(statSync(out).blocks * 512 < g.size, 'sparse output');
  assert.ok(existsSync(out));
});

test('volumes from different disks, or an image smaller than its partition, are refused', { skip: !have('sgdisk') && 'sgdisk not installed' }, async () => {
  const d = mkdtempSync(join(dir, 'refuse-'));
  const g = buildGptDisk(d);
  const small = join(d, 'small.vhd');
  writeVhd(small, { size: IMAGE_SKIP + 1024 * 1024 });
  const img = await openImageChain([small]);
  const c = parseUrbackupMbr(encodeMbrData({ partitionNumber: 2, mbr: g.mbr, gpt: g.gpt }));
  const other = parseUrbackupMbr(encodeMbrData({ partitionNumber: 1, serial: 'OTHERDISK', mbr: g.mbr, gpt: g.gpt }));
  await assert.rejects(assembleDisk(join(d, 'o1.raw'), [{ letter: 'C:', mbr: c, image: img, skip: IMAGE_SKIP }]), /holds .* but its partition is/);
  await assert.rejects(assembleDisk(join(d, 'o2.raw'), [
    { letter: 'C:', mbr: c, image: img, skip: IMAGE_SKIP }, { letter: 'ESP', mbr: other, image: img, skip: IMAGE_SKIP },
  ]), /different disk/);
  await assert.rejects(assembleDisk(join(d, 'o3.raw'), [{ letter: 'C:', mbr: c, image: img, skip: IMAGE_SKIP }], { maxSize: 1024 * 1024 }), /limit/);
  await img.close();
});
