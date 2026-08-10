// BUILD-TIME: for a given scene frame, enumerate SPRITES and hunt each
// sprite's tile bytes on disc via the LZSS index. If sprites are static
// disc-loaded content (like the bio-cell images in junker_db), we can bundle
// them and render them. If they're dynamic (composed at runtime by the text
// engine), the hunter won't find them and we skip.
//
//   npx tsx port/build/hunt_sprites.ts <frame>

import fs from 'node:fs'; import path from 'node:path';
import { decompressLzss } from './lzss.ts';
import { loadIndex } from './lzss_index.ts';

const frame = parseInt(process.argv[2] ?? '0', 10);
if (!frame) { console.error('usage: hunt_sprites.ts <frame>'); process.exit(1); }

const S = path.join(import.meta.dirname, '..', 'rendered', 'intro', 'state.bin');
const buf = fs.readFileSync(S);
const vs = buf.readUInt32LE(10), cs = buf.readUInt32LE(14), vss = buf.readUInt32LE(18), rs = buf.readUInt32LE(22);
let o = 26;
const vram = new Uint8Array(buf.subarray(o, o + vs)); o += vs;
const cram = new Uint8Array(buf.subarray(o, o + cs)); o += cs;
const vsram = new Uint8Array(buf.subarray(o, o + vss)); o += vss;
const reg = new Uint8Array(buf.subarray(o, o + rs)); o += rs;
const ad = (d: Uint8Array) => { const c = buf.readUInt16LE(o); o += 2; for (let i = 0; i < c; i++) { const of = buf.readUInt16LE(o); o += 2; const l = buf.readUInt16LE(o); o += 2; d.set(buf.subarray(o, o + l), of); o += l; } };
for (let f = 1; f <= frame; f++) { ad(vram); ad(cram); ad(vsram); ad(reg); }

// Walk the SAT link chain (same as vdp.ts drawSprites, LE bytes).
const satBase = (reg[5] & 0x7f) << 9;
const spriteTiles = new Set<number>();
let idx = 0;
const seen = new Set<number>();
for (let i = 0; i < 80; i++) {
  if (seen.has(idx)) break;
  seen.add(idx);
  const off = satBase + idx * 8;
  const yRaw = (vram[off] | (vram[off + 1] << 8)) & 0x3ff;
  const size = vram[off + 3];
  const attr = vram[off + 4] | (vram[off + 5] << 8);
  const xRaw = (vram[off + 6] | (vram[off + 7] << 8)) & 0x3ff;
  const link = vram[off + 2];
  const hcells = ((size >> 2) & 3) + 1;
  const vcells = (size & 3) + 1;
  const y = yRaw - 128, x = xRaw - 128;
  const baseTile = attr & 0x7ff, pal = (attr >> 13) & 3;
  const onScreen = x + hcells * 8 > 0 && x < 320 && y + vcells * 8 > 0 && y < 240;
  if (onScreen) {
    for (let t = 0; t < hcells * vcells; t++) spriteTiles.add((baseTile + t) & 0x7ff);
    console.log(`  sprite ${idx}: (${x},${y}) ${hcells}x${vcells} tiles $${baseTile.toString(16)}..$${(baseTile + hcells*vcells - 1).toString(16)} pal=${pal}`);
  }
  if (link === 0) break;
  idx = link;
}
console.log(`\nunique sprite tiles: ${spriteTiles.size}`);
if (spriteTiles.size === 0) { console.log('  no on-screen sprites'); process.exit(0); }

// Hunt via LZSS index — pick highest-variance sprite tile as fingerprint.
const stiles = [...spriteTiles].sort((a, b) => a - b);
let bestTile = stiles[0], bestScore = 0;
for (const t of spriteTiles) {
  let nz = 0; for (let i = 0; i < 32; i++) if (vram[t * 32 + i] !== 0) nz++;
  if (nz > bestScore) { bestScore = nz; bestTile = t; }
}
const raw = Buffer.from(vram.subarray(bestTile * 32, bestTile * 32 + 32));
const swp = Buffer.alloc(32);
for (let i = 0; i < 32; i += 2) { swp[i] = raw[i + 1]; swp[i + 1] = raw[i]; }
console.log(`fingerprint sprite tile $${bestTile.toString(16)} (${bestScore}/32 non-zero)`);

const index = loadIndex();
let hit: { file: string; off: number; size: number; loadTileBase: number } | null = null;
for (const e of index) {
  try {
    const d = fs.readFileSync(path.join('D:/blastem/snatcher/extracted', e.file));
    const dec = Buffer.from(decompressLzss(d, e.off + 2, e.size));
    const decSwp = Buffer.alloc(dec.length);
    for (let i = 0; i + 1 < dec.length; i += 2) { decSwp[i] = dec[i + 1]; decSwp[i + 1] = dec[i]; }
    const pos = decSwp.indexOf(swp);
    if (pos >= 0 && pos % 32 === 0) {
      hit = { file: e.file, off: e.off, size: e.size, loadTileBase: bestTile - (pos / 32) };
      break;
    }
  } catch { }
}
if (!hit) { console.log(`  sprite tiles NOT on disc — dynamic-composed`); process.exit(0); }

console.log(`  SPRITE TILES: ${hit.file} @$${hit.off.toString(16)} LZSS(size=$${hit.size.toString(16)}) → loads to tile $${hit.loadTileBase.toString(16)}`);
// Verify coverage
const d = fs.readFileSync(path.join('D:/blastem/snatcher/extracted', hit.file));
const dec = Buffer.from(decompressLzss(d, hit.off + 2, hit.size));
const decSwp = Buffer.alloc(dec.length);
for (let i = 0; i + 1 < dec.length; i += 2) { decSwp[i] = dec[i + 1]; decSwp[i + 1] = dec[i]; }
let covered = 0;
for (const t of spriteTiles) {
  const bo = (t - hit.loadTileBase) * 32;
  if (bo < 0 || bo + 32 > decSwp.length) continue;
  if (decSwp.subarray(bo, bo + 32).equals(Buffer.from(vram.subarray(t * 32, t * 32 + 32)))) covered++;
}
console.log(`  SPRITE COVERAGE: ${covered}/${spriteTiles.size}${covered === spriteTiles.size ? ' ✓' : ''}`);
