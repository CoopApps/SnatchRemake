// Pin subway_corridor asset locations on disc EXACTLY. We know DATA_D1.BIN
// $143e (u16 BE size prefix = $14e0, decoded 5344 bytes) contains the tile
// data (byte-swapped vs VRAM order). Now: (a) verify EVERY used tile is in
// that decoded block, (b) locate the palette on disc, (c) locate the
// nametable on disc.

import fs from 'node:fs'; import path from 'node:path';
import { decompressLzss } from './lzss.ts';

const S = path.join(import.meta.dirname, '..', 'rendered', 'intro', 'state.bin');
const buf = fs.readFileSync(S);
const vs = buf.readUInt32LE(10), cs = buf.readUInt32LE(14), vss = buf.readUInt32LE(18), rs = buf.readUInt32LE(22);
let o = 26;
const vram = new Uint8Array(buf.subarray(o, o + vs)); o += vs;
const cram = new Uint8Array(buf.subarray(o, o + cs)); o += cs;
const vsram = new Uint8Array(buf.subarray(o, o + vss)); o += vss;
const reg = new Uint8Array(buf.subarray(o, o + rs)); o += rs;
const ad = (d: Uint8Array) => { const c = buf.readUInt16LE(o); o += 2; for (let i = 0; i < c; i++) { const of = buf.readUInt16LE(o); o += 2; const l = buf.readUInt16LE(o); o += 2; d.set(buf.subarray(o, o + l), of); o += l; } };
for (let f = 1; f <= 6560; f++) { ad(vram); ad(cram); ad(vsram); ad(reg); }

// ---- (a) verify tile-block coverage ----
const disc = fs.readFileSync('D:/blastem/snatcher/extracted/DATA_D1.BIN');
const decoded = Buffer.from(decompressLzss(disc, 0x143e + 2, 0x14e0));
console.log(`DATA_D1 $143e LZSS → ${decoded.length}B decoded (expected 5344)`);

// The block is in the ROM's byte order (BE 68000). VRAM stores byte-swapped
// (LE uint16* on x86 hosts). Un-swap `decoded` to match VRAM's storage order.
const swapped = Buffer.alloc(decoded.length);
for (let i = 0; i + 1 < decoded.length; i += 2) { swapped[i] = decoded[i + 1]; swapped[i + 1] = decoded[i]; }

const ntBase = (reg[2] & 0x38) << 10;
const used = new Set<number>();
for (let row = 0; row < 28; row++) for (let col = 0; col < 32; col++) {
  const off = ntBase + (row * 32 + col) * 2;
  const w = vram[off] | (vram[off + 1] << 8);
  const t = w & 0x7ff; if (t > 0) used.add(t);
}
const sorted = [...used].sort((a, b) => a - b);

// If the block starts loading at VRAM tile index N, then decoded byte 0 =
// VRAM byte (N*32). Search for first used tile's bytes IN decoded to find N.
const firstTileVram = Buffer.from(vram.subarray(sorted[0] * 32, sorted[0] * 32 + 32));
const idx = swapped.indexOf(firstTileVram);
if (idx < 0) { console.log(`  first tile $${sorted[0].toString(16)} not found in block!`); }
else {
  const loadTileBase = sorted[0] - (idx / 32);
  console.log(`  block loads to VRAM tile $${loadTileBase.toString(16)} (first used tile $${sorted[0].toString(16)} = block byte $${idx.toString(16)})`);
  // Now check every used tile is present at the expected offset.
  let covered = 0;
  for (const t of used) {
    const bo = (t - loadTileBase) * 32;
    if (bo < 0 || bo + 32 > swapped.length) continue;
    const match = swapped.subarray(bo, bo + 32).equals(Buffer.from(vram.subarray(t * 32, t * 32 + 32)));
    if (match) covered++;
  }
  console.log(`  ${covered}/${used.size} used tiles verified in decoded block`);
}

// ---- (b) locate palette on disc ----
const palWords: number[] = [];
for (let line = 0; line < 4; line++) for (let i = 0; i < 16; i++) {
  const p = cram[(line * 16 + i) * 2] | (cram[(line * 16 + i) * 2 + 1] << 8);
  const r = p & 7, g = (p >> 3) & 7, b = (p >> 6) & 7;
  palWords.push((b << 9) | (g << 5) | (r << 1));   // Genesis 0BGR word
}
// Try just line 0 first — usually 16 words = 32 bytes BE.
const line0BE = Buffer.alloc(32);
for (let i = 0; i < 16; i++) { line0BE[i * 2] = palWords[i] >> 8; line0BE[i * 2 + 1] = palWords[i] & 0xff; }
const line0LE = Buffer.alloc(32);
for (let i = 0; i < 16; i++) { line0LE[i * 2] = palWords[i] & 0xff; line0LE[i * 2 + 1] = palWords[i] >> 8; }
console.log(`\npalette line 0 words (Genesis 0BGR): ${palWords.slice(0, 16).map(w => '0x' + w.toString(16).padStart(3, '0')).join(' ')}`);
console.log(`  BE bytes: ${line0BE.toString('hex')}`);
console.log(`  LE bytes: ${line0LE.toString('hex')}`);

const files = fs.readdirSync('D:/blastem/snatcher/extracted').filter(f => /\.BIN$/i.test(f));
for (const f of files) {
  const d = fs.readFileSync(path.join('D:/blastem/snatcher/extracted', f));
  const iB = d.indexOf(line0BE);
  const iL = d.indexOf(line0LE);
  if (iB >= 0) console.log(`  palette BE match in ${f} at $${iB.toString(16)}`);
  if (iL >= 0) console.log(`  palette LE match in ${f} at $${iL.toString(16)}`);
}

// ---- (c) locate nametable on disc ----
// Nametable is 32x28 = 896 words = 1792 bytes. In VRAM at $E000. On disc it
// might be raw (2 bytes per cell, tile-index low + hi + flip/pal high) or in
// a compressed form.
const nt = Buffer.alloc(1792);
for (let row = 0; row < 28; row++) for (let col = 0; col < 32; col++) {
  const vo = ntBase + (row * 32 + col) * 2;
  nt[(row * 32 + col) * 2]     = vram[vo];
  nt[(row * 32 + col) * 2 + 1] = vram[vo + 1];
}
console.log(`\nnametable first 32B: ${nt.subarray(0, 32).toString('hex')}`);
for (const f of files) {
  const d = fs.readFileSync(path.join('D:/blastem/snatcher/extracted', f));
  const i = d.indexOf(nt.subarray(0, 64));   // first 32 words is enough uniqueness
  if (i >= 0) console.log(`  nametable RAW match in ${f} at $${i.toString(16)}`);
}
