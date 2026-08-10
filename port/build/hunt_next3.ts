// Next hunts (ORACLE use only): sprite PLACEMENT tables, city_credits
// plane-A nametable, Gillian's own sprite tile block.

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
  const want = new Set(frames); const out = new Map<number, Snap>();
  for (let f = 1; f <= Math.max(...frames); f++) {
    ad(vram); ad(cram); ad(vsram); ad(reg);
    if (want.has(f)) out.set(f, { vram: new Uint8Array(vram), cram: new Uint8Array(cram), reg: new Uint8Array(reg) });
  }
  return out;
}
const snaps = snapshotAt([6560, 15840, 23760]);

console.log('decoding blocks...');
const idxE = loadIndex();
const discCache = new Map<string, Buffer>();
const blocks: { file: string; off: number; size: number; dec: Buffer; sw: Buffer }[] = [];
for (const e of idxE) {
  try {
    if (!discCache.has(e.file)) discCache.set(e.file, fs.readFileSync(path.join('D:/blastem/snatcher/extracted', e.file)));
    const dc = Buffer.from(decompressLzss(discCache.get(e.file)!, e.off + 2, 0x20000));
    if (dc.length < 64) continue;
    const sw = Buffer.alloc(dc.length);
    for (let i = 0; i + 1 < dc.length; i += 2) { sw[i] = dc[i + 1]; sw[i + 1] = dc[i]; }
    blocks.push({ file: e.file, off: e.off, size: e.size, dec: dc, sw });
  } catch { }
}
// Also load ALL raw disc files for raw searching.
for (const f of fs.readdirSync('D:/blastem/snatcher/extracted').filter(f => /\.BIN$/i.test(f)))
  if (!discCache.has(f)) discCache.set(f, fs.readFileSync(path.join('D:/blastem/snatcher/extracted', f)));
console.log(`${blocks.length} blocks, ${discCache.size} raw files\n`);

// ---- 1. sprite PLACEMENT tables (junker_db f6560) ----
console.log('=== 1. sprite placement hunt (junker_db f6560) ===');
{
  const snap = snaps.get(6560)!;
  const sat = (snap.reg[5] & 0x7f) << 9;
  // Collect the on-screen sprite records in SAT order.
  const recs: { y: number; size: number; attr: number; x: number }[] = [];
  let idx = 0; const seen = new Set<number>();
  for (let i = 0; i < 80; i++) {
    if (seen.has(idx)) break; seen.add(idx);
    const off = sat + idx * 8;
    const y = (snap.vram[off] | (snap.vram[off + 1] << 8)) & 0x3ff;
    const size = snap.vram[off + 3];
    const attr = snap.vram[off + 4] | (snap.vram[off + 5] << 8);
    const x = (snap.vram[off + 6] | (snap.vram[off + 7] << 8)) & 0x3ff;
    const link = snap.vram[off + 2];
    if (y - 128 > -32 && y - 128 < 240) recs.push({ y, size, attr, x });
    if (link === 0) break;
    idx = link;
  }
  console.log(`${recs.length} on-screen sprite records`);
  // Probe encodings across 4 consecutive records (r..r+3):
  const encodings: { name: string; make: (r: typeof recs[number]) => number[] }[] = [
    { name: 'BE y,szlk?,attr,x (8B, no link)', make: r => [r.y >> 8, r.y & 0xff, r.size, 0, r.attr >> 8, r.attr & 0xff, r.x >> 8, r.x & 0xff] },
    { name: 'BE attr,x (4B)',                  make: r => [r.attr >> 8, r.attr & 0xff, r.x >> 8, r.x & 0xff] },
    { name: 'BE x,y (4B)',                     make: r => [r.x >> 8, r.x & 0xff, r.y >> 8, r.y & 0xff] },
    { name: 'bytes x-128,y-128,size,0 (4B)',   make: r => [(r.x - 128) & 0xff, (r.y - 128) & 0xff, r.size, 0] },
    { name: 'BE y,x (4B)',                     make: r => [r.y >> 8, r.y & 0xff, r.x >> 8, r.x & 0xff] },
  ];
  for (const enc of encodings) {
    // needle = 3 consecutive records (skip record 0 which is often a dummy)
    for (const start of [1, 2, 5]) {
      if (start + 3 > recs.length) continue;
      const needle = Buffer.from(recs.slice(start, start + 3).flatMap(enc.make));
      let hit = '';
      for (const [f, d] of discCache) { const i = d.indexOf(needle); if (i >= 0) { hit = `RAW ${f}@$${i.toString(16)}`; break; } }
      if (!hit) for (const b of blocks) { const i = b.dec.indexOf(needle); if (i >= 0) { hit = `LZSS ${b.file}@$${b.off.toString(16)}+$${i.toString(16)}`; break; } }
      if (hit) console.log(`  ${enc.name} [recs ${start}..${start + 2}]: ${hit}`);
    }
  }
  console.log('  (no output above = placements not stored in probed encodings)');
}

// ---- 2. city_credits plane-A nametable (f15840) ----
console.log('\n=== 2. city_credits plane-A NT (f15840) ===');
{
  const snap = snaps.get(15840)!;
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
  console.log(`probe rows: ${probes.map(p => `${p.r}(${p.distinct})`).join(' ')}`);
  let any = false;
  for (const b of blocks) {
    let n = 0;
    for (const p of probes) if (b.dec.indexOf(p.be) >= 0) n++;
    if (n >= 2) { console.log(`  ${b.file} @$${b.off.toString(16)} (size=$${b.size.toString(16)}): ${n}/3`); any = true; }
  }
  if (!any) console.log('  not found (scene may use scrolling 64-wide plane — try planeCols 64)');
}

// ---- 3. Gillian sprite tiles (f23760) ----
console.log('\n=== 3. gillian sprite tiles (f23760) ===');
{
  const snap = snaps.get(23760)!;
  const sat = (snap.reg[5] & 0x7f) << 9;
  const tiles = new Set<number>();
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
      for (let t = 0; t < hc * vc; t++) tiles.add((attr + t) & 0x7ff);
    if (link === 0) break;
    idx = link;
  }
  const list = [...tiles];
  // 3 probes; find block covering most.
  const probes = list
    .map(t => { let nz = 0; for (let i = 0; i < 32; i++) if (snap.vram[t * 32 + i] !== 0) nz++; return { t, nz }; })
    .sort((a, b) => b.nz - a.nz).slice(0, 3);
  let best: { file: string; off: number; base: number; cov: number } | null = null;
  for (const b of blocks) {
    for (const p of probes) {
      const pos = b.sw.indexOf(Buffer.from(snap.vram.subarray(p.t * 32, p.t * 32 + 32)));
      if (pos < 0 || pos % 32 !== 0) continue;
      const base = p.t - pos / 32;
      let cov = 0;
      for (const t of list) {
        const bo = (t - base) * 32;
        if (bo >= 0 && bo + 32 <= b.sw.length && b.sw.subarray(bo, bo + 32).equals(Buffer.from(snap.vram.subarray(t * 32, t * 32 + 32)))) cov++;
      }
      if (!best || cov > best.cov) best = { file: b.file, off: b.off, base, cov };
    }
  }
  if (best) console.log(`  ${best.file} @$${best.off.toString(16)} base $${best.base.toString(16)} — ${best.cov}/${list.length}`);
  else console.log('  not found');
}
