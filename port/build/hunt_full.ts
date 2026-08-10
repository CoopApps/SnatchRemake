// Full iterative plane-A hunt: find ALL tile blocks (multi-round) + palette
// + nametable for a frame, print a ready-to-paste scenes.ts entry.
// ORACLE use only. Uses the decoded-block cache for speed.
//   npx tsx port/build/hunt_full.ts <frame>

import fs from 'node:fs'; import path from 'node:path';
import { decompressLzss } from './lzss.ts';
import { loadIndex } from './lzss_index.ts';

const frame = parseInt(process.argv[2], 10);
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

const nt = (reg[2] & 0x38) << 10;
const used = new Set<number>();
for (let r = 0; r < 28; r++) for (let c = 0; c < 32; c++) {
  const w = vram[nt + (r * 32 + c) * 2] | (vram[nt + (r * 32 + c) * 2 + 1] << 8);
  if ((w & 0x7ff) > 0) used.add(w & 0x7ff);
}
console.log(`f${frame}: ${used.size} plane-A tiles`);

const idxE = loadIndex();
const dfc = new Map<string, Buffer>();
for (const e of idxE) if (!dfc.has(e.file)) dfc.set(e.file, fs.readFileSync(path.join('D:/blastem/snatcher/extracted', e.file)));
const cache: { file: string; off: number; size: number; sw: Buffer }[] = [];
for (const e of idxE) {
  try {
    const dc = Buffer.from(decompressLzss(dfc.get(e.file)!, e.off + 2, 0x20000));
    if (dc.length < 64) continue;
    const sw = Buffer.alloc(dc.length);
    for (let i = 0; i + 1 < dc.length; i += 2) { sw[i] = dc[i + 1]; sw[i + 1] = dc[i]; }
    cache.push({ file: e.file, off: e.off, size: e.size, sw });
  } catch { }
}

let missing = [...used];
const found: { file: string; off: number; base: number }[] = [];
for (let round = 0; round < 8 && missing.length; round++) {
  const probes = missing.map(t => { let nz = 0; for (let i = 0; i < 32; i++) if (vram[t * 32 + i] !== 0) nz++; return { t, nz }; })
    .sort((a, b) => b.nz - a.nz).slice(0, 4);
  let best: { file: string; off: number; base: number; covers: Set<number> } | null = null;
  for (const b of cache) {
    if (found.some(f => f.file === b.file && f.off === b.off)) continue;
    for (const p of probes) {
      const pos = b.sw.indexOf(Buffer.from(vram.subarray(p.t * 32, p.t * 32 + 32)));
      if (pos < 0 || pos % 32 !== 0) continue;
      const base = p.t - pos / 32;
      const covers = new Set<number>();
      for (const t of missing) { const bo = (t - base) * 32; if (bo >= 0 && bo + 32 <= b.sw.length && b.sw.subarray(bo, bo + 32).equals(Buffer.from(vram.subarray(t * 32, t * 32 + 32)))) covers.add(t); }
      if (!best || covers.size > best.covers.size) best = { file: b.file, off: b.off, base, covers };
      break;
    }
  }
  if (!best || best.covers.size === 0) { console.log(`  ${missing.length} tiles UNPINNED after ${round} rounds`); break; }
  found.push({ file: best.file, off: best.off, base: best.base });
  missing = missing.filter(t => !best!.covers.has(t));
  console.log(`  block: ${best.file} @$${best.off.toString(16)} base $${best.base.toString(16)} +${best.covers.size} (${missing.length} left)`);
}

// NT
const nrows: { r: number; distinct: number; be: Buffer }[] = [];
for (let r = 0; r < 28; r++) { const be = Buffer.alloc(64); const t = new Set<number>(); for (let c = 0; c < 32; c++) { const lo = vram[nt + (r * 32 + c) * 2], hi = vram[nt + (r * 32 + c) * 2 + 1]; be[c * 2] = hi; be[c * 2 + 1] = lo; t.add(((hi << 8) | lo) & 0x7ff); } nrows.push({ r, distinct: t.size, be }); }
nrows.sort((a, b) => b.distinct - a.distinct);
let ntHit = '';
for (const b of cache) { let n = 0; for (const p of nrows.slice(0, 3)) { const orig = Buffer.alloc(b.sw.length); for (let i = 0; i + 1 < b.sw.length; i += 2) { orig[i] = b.sw[i + 1]; orig[i + 1] = b.sw[i]; } if (orig.indexOf(p.be) >= 0) n++; } if (n >= 2) { ntHit = `${b.file} @$${b.off.toString(16)}`; break; } }
// palette
const pal0 = Buffer.alloc(32);
for (let i = 0; i < 16; i++) { const p = cram[i * 2] | (cram[i * 2 + 1] << 8); const w = (((p >> 6) & 7) << 9) | (((p >> 3) & 7) << 5) | ((p & 7) << 1); pal0[i * 2] = w >> 8; pal0[i * 2 + 1] = w & 0xff; }
let palHit = '';
for (const [f, d] of dfc) { const i = d.indexOf(pal0); if (i >= 0) { palHit = `${f} @$${i.toString(16)}`; break; } }

console.log(`\n  tiles ${found.length} blocks, ${missing.length} unpinned`);
console.log(`  NT: ${ntHit || 'NOT FOUND'}`);
console.log(`  PAL: ${palHit || 'NOT FOUND'}`);
if (!missing.length && ntHit && palHit) {
  console.log('\n  READY — paste tiles[] with these blocks:');
  found.forEach((b, i) => console.log(`    { ${i ? `name: '${String.fromCharCode(65 + i)}', ` : ''}file: '${b.file}', offset: 0x${b.off.toString(16)}, compression: 'lzss', sizePrefix: true${i ? `, loadTileBase: 0x${b.base.toString(16)}` : ''} },`));
}
