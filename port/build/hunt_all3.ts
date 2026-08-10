// Comprehensive hunt (ORACLE use only — capture guides disc lookup, port
// ships disc bytes):
//  1. sprite tiles for junker_db/portraits/wireframe (fixed byte-order compare)
//  2. moscow_title NT + block-2s for street_ident/title_reveal/city_credits/prod_credits
//  3. Gillian portrait palette lines 1-3
// Decodes every indexed LZSS block ONCE into memory (VRAM byte order), then
// runs all queries against the cache.

import fs from 'node:fs'; import path from 'node:path';
import { decompressLzss } from './lzss.ts';
import { loadIndex } from './lzss_index.ts';

const S = path.join(import.meta.dirname, '..', 'rendered', 'intro', 'state.bin');
const buf = fs.readFileSync(S);
const vs = buf.readUInt32LE(10), cs = buf.readUInt32LE(14), vss = buf.readUInt32LE(18), rs = buf.readUInt32LE(22);

interface Snap { vram: Uint8Array; cram: Uint8Array; reg: Uint8Array; }
function snapshotAt(frames: number[]): Map<number, Snap> {
  let o = 26;
  const vram = new Uint8Array(buf.subarray(o, o + vs)); o += vs;
  const cram = new Uint8Array(buf.subarray(o, o + cs)); o += cs;
  const vsram = new Uint8Array(buf.subarray(o, o + vss)); o += vss;
  const reg = new Uint8Array(buf.subarray(o, o + rs)); o += rs;
  const ad = (d: Uint8Array) => { const c = buf.readUInt16LE(o); o += 2; for (let i = 0; i < c; i++) { const of = buf.readUInt16LE(o); o += 2; const l = buf.readUInt16LE(o); o += 2; d.set(buf.subarray(o, o + l), of); o += l; } };
  const want = new Set(frames);
  const out = new Map<number, Snap>();
  const maxF = Math.max(...frames);
  for (let f = 1; f <= maxF; f++) {
    ad(vram); ad(cram); ad(vsram); ad(reg);
    if (want.has(f)) out.set(f, { vram: new Uint8Array(vram), cram: new Uint8Array(cram), reg: new Uint8Array(reg) });
  }
  return out;
}

const FRAMES = [5760, 6560, 10240, 12000, 15840, 18240, 19680, 22800, 23760];
console.log('building snapshots...');
const snaps = snapshotAt(FRAMES);

// ---- decode all indexed blocks once, keep in VRAM byte order ----
console.log('decoding all indexed blocks...');
const idxE = loadIndex();
const discCache = new Map<string, Buffer>();
const blocks: { file: string; off: number; size: number; sw: Buffer }[] = [];
for (const e of idxE) {
  try {
    if (!discCache.has(e.file)) discCache.set(e.file, fs.readFileSync(path.join('D:/blastem/snatcher/extracted', e.file)));
    const dc = Buffer.from(decompressLzss(discCache.get(e.file)!, e.off + 2, 0x20000));
    if (dc.length < 64) continue;
    const sw = Buffer.alloc(dc.length);
    for (let i = 0; i + 1 < dc.length; i += 2) { sw[i] = dc[i + 1]; sw[i + 1] = dc[i]; }
    blocks.push({ file: e.file, off: e.off, size: e.size, sw });   // sw = VRAM byte order
  } catch { }
}
console.log(`${blocks.length} blocks decoded\n`);

function findTiles(snap: Snap, tiles: number[], label: string) {
  if (!tiles.length) { console.log(`${label}: no tiles`); return; }
  // probes: 3 highest-variance
  const probes = tiles
    .map(t => { let nz = 0; for (let i = 0; i < 32; i++) if (snap.vram[t * 32 + i] !== 0) nz++; return { t, nz }; })
    .sort((a, b) => b.nz - a.nz).slice(0, 3)
    .map(({ t }) => ({ t, bytes: Buffer.from(snap.vram.subarray(t * 32, t * 32 + 32)) }));
  let best: { file: string; off: number; size: number; base: number; cov: number } | null = null;
  for (const b of blocks) {
    const pos = b.sw.indexOf(probes[0].bytes);
    if (pos < 0 || pos % 32 !== 0) continue;
    const base = probes[0].t - pos / 32;
    let cov = 0;
    for (const t of tiles) {
      const bo = (t - base) * 32;
      if (bo >= 0 && bo + 32 <= b.sw.length && b.sw.subarray(bo, bo + 32).equals(Buffer.from(snap.vram.subarray(t * 32, t * 32 + 32)))) cov++;
    }
    if (!best || cov > best.cov) best = { file: b.file, off: b.off, size: b.size, base, cov };
  }
  if (best) console.log(`${label}: ${best.file} @$${best.off.toString(16)} (size=$${best.size.toString(16)}) base $${best.base.toString(16)} — ${best.cov}/${tiles.length}${best.cov === tiles.length ? ' ✓' : ''}`);
  else console.log(`${label}: NOT FOUND (${tiles.length} tiles)`);
}

function spriteTiles(snap: Snap): number[] {
  const sat = (snap.reg[5] & 0x7f) << 9;
  const out = new Set<number>();
  let idx = 0; const seen = new Set<number>();
  for (let i = 0; i < 80; i++) {
    if (seen.has(idx)) break; seen.add(idx);
    const off = sat + idx * 8;
    const y = (snap.vram[off] | (snap.vram[off + 1] << 8)) & 0x3ff;
    const size = snap.vram[off + 3];
    const attr = snap.vram[off + 4] | (snap.vram[off + 5] << 8);
    const x = (snap.vram[off + 6] | (snap.vram[off + 7] << 8)) & 0x3ff;
    const link = snap.vram[off + 2];
    const hc = ((size >> 2) & 3) + 1, vc = (size & 3) + 1;
    if (x - 128 + hc * 8 > 0 && x - 128 < 320 && y - 128 + vc * 8 > 0 && y - 128 < 240)
      for (let t = 0; t < hc * vc; t++) out.add((attr + t) & 0x7ff);
    if (link === 0) break;
    idx = link;
  }
  return [...out];
}

function planeATiles(snap: Snap): number[] {
  const nt = (snap.reg[2] & 0x38) << 10;
  const out = new Set<number>();
  for (let r = 0; r < 28; r++) for (let c = 0; c < 32; c++) {
    const w = snap.vram[nt + (r * 32 + c) * 2] | (snap.vram[nt + (r * 32 + c) * 2 + 1] << 8);
    if ((w & 0x7ff) > 0) out.add(w & 0x7ff);
  }
  return [...out];
}

// ==== 1. SPRITES ====
console.log('=== 1. sprite tiles (fixed byte-order) ===');
for (const [f, label] of [[6560, 'junker_db'], [10240, 'wireframe_body'], [22800, 'portrait_katrina'], [23760, 'portrait_gillian']] as const)
  findTiles(snaps.get(f)!, spriteTiles(snaps.get(f)!), `${label} sprites (f${f})`);

// ==== 2. NTs and block-2s ====
console.log('\n=== 2a. moscow_title nametable (f5760) ===');
{
  const snap = snaps.get(5760)!;
  const nt = (snap.reg[2] & 0x38) << 10;
  const rows: { r: number; distinct: number; be: Buffer }[] = [];
  for (let r = 0; r < 28; r++) {
    const be = Buffer.alloc(64); const t = new Set<number>();
    for (let c = 0; c < 32; c++) {
      const lo = snap.vram[nt + (r * 32 + c) * 2], hi = snap.vram[nt + (r * 32 + c) * 2 + 1];
      be[c * 2] = hi; be[c * 2 + 1] = lo;
      t.add(((hi << 8) | lo) & 0x7ff);
    }
    rows.push({ r, distinct: t.size, be });
  }
  rows.sort((a, b) => b.distinct - a.distinct);
  const probes = rows.slice(0, 3);
  for (const b of blocks) {
    // NT search: disc data is BE — search the ORIGINAL (un-swapped) decode.
    const orig = Buffer.alloc(b.sw.length);
    for (let i = 0; i + 1 < b.sw.length; i += 2) { orig[i] = b.sw[i + 1]; orig[i + 1] = b.sw[i]; }
    let n = 0;
    for (const p of probes) if (orig.indexOf(p.be) >= 0) n++;
    if (n >= 2) console.log(`  ${b.file} @$${b.off.toString(16)} (size=$${b.size.toString(16)}): ${n}/3 probe rows`);
  }
}

console.log('\n=== 2b. block-2 hunts ===');
const B2: [number, string, string, number, number][] = [
  [18240, 'street_ident', 'DATA_D0.BIN', 0x113b6, 0x300],
  [12000, 'title_reveal', 'DATA_D0.BIN', 0x2a70, 0x300],
  [15840, 'city_credits', 'DATA_D0.BIN', 0xdcba, 0x500],
  [19680, 'prod_credits', 'DATA_D0.BIN', 0x18278, 0x180],
];
for (const [f, label, b1f, b1o, base] of B2) {
  const snap = snaps.get(f)!;
  const used = planeATiles(snap);
  const d1 = discCache.get(b1f) ?? fs.readFileSync(path.join('D:/blastem/snatcher/extracted', b1f));
  const dec1 = Buffer.from(decompressLzss(d1, b1o + 2, 0x20000));
  const sw1 = Buffer.alloc(dec1.length);
  for (let i = 0; i + 1 < dec1.length; i += 2) { sw1[i] = dec1[i + 1]; sw1[i + 1] = dec1[i]; }
  const missing = used.filter(t => {
    const bo = (t - base) * 32;
    return !(bo >= 0 && bo + 32 <= sw1.length && sw1.subarray(bo, bo + 32).equals(Buffer.from(snap.vram.subarray(t * 32, t * 32 + 32))));
  });
  findTiles(snap, missing, `${label} missing ${missing.length}/${used.length} (f${f})`);
}

// ==== 3. Gillian palette lines 1-3 ====
console.log('\n=== 3. gillian palette lines (f23760) ===');
{
  const snap = snaps.get(23760)!;
  for (let line = 0; line < 4; line++) {
    const pal = Buffer.alloc(32);
    for (let i = 0; i < 16; i++) {
      const p = snap.cram[(line * 16 + i) * 2] | (snap.cram[(line * 16 + i) * 2 + 1] << 8);
      const w = (((p >> 6) & 7) << 9) | (((p >> 3) & 7) << 5) | ((p & 7) << 1);
      pal[i * 2] = w >> 8; pal[i * 2 + 1] = w & 0xff;
    }
    const hits: string[] = [];
    for (const [f, d] of discCache) {
      let i = d.indexOf(pal);
      while (i >= 0 && hits.length < 3) { hits.push(`${f}@$${i.toString(16)}`); i = d.indexOf(pal, i + 1); }
    }
    console.log(`  line ${line}: ${hits.length ? hits.join(' ') : 'NOT FOUND raw'}`);
  }
}
