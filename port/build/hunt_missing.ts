// Full-decode index hunt for a scene's MISSING tiles (the ones block-1
// didn't cover). For each candidate block, fully decode and check where the
// missing tiles' bytes appear. ORACLE use only — capture bytes locate disc
// blocks; the port ships disc bytes.
//
//   npx tsx port/build/hunt_missing.ts <frame> <block1File> <block1OffHex> <loadTileBaseHex>

import fs from 'node:fs'; import path from 'node:path';
import { decompressLzss } from './lzss.ts';
import { loadIndex } from './lzss_index.ts';

const [frameS, b1File, b1OffS, baseS] = process.argv.slice(2);
const frame = parseInt(frameS, 10), b1Off = parseInt(b1OffS, 16), base = parseInt(baseS, 16);

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

const ntA = (reg[2] & 0x38) << 10;
const used = new Set<number>();
for (let row = 0; row < 28; row++) for (let col = 0; col < 32; col++) {
  const w = vram[ntA + (row * 32 + col) * 2] | (vram[ntA + (row * 32 + col) * 2 + 1] << 8);
  if ((w & 0x7ff) > 0) used.add(w & 0x7ff);
}

// Coverage from block 1.
const d1 = fs.readFileSync(path.join('D:/blastem/snatcher/extracted', b1File));
const dec1 = Buffer.from(decompressLzss(d1, b1Off + 2, 0x20000));
const swp1 = Buffer.alloc(dec1.length);
for (let i = 0; i + 1 < dec1.length; i += 2) { swp1[i] = dec1[i + 1]; swp1[i + 1] = dec1[i]; }
const missing: number[] = [];
for (const t of used) {
  const bo = (t - base) * 32;
  const ok = bo >= 0 && bo + 32 <= swp1.length &&
    swp1.subarray(bo, bo + 32).equals(Buffer.from(vram.subarray(t * 32, t * 32 + 32)));
  if (!ok) missing.push(t);
}
missing.sort((a, b) => a - b);
console.log(`f${frame}: ${used.size} used, ${missing.length} missing after block1 (range $${missing[0]?.toString(16)}..$${missing.at(-1)?.toString(16)})`);
if (!missing.length) process.exit(0);

// Probe = 3 highest-variance missing tiles.
const probes = missing
  .map(t => { let nz = 0; for (let i = 0; i < 32; i++) if (vram[t * 32 + i] !== 0) nz++; return { t, nz }; })
  .sort((a, b) => b.nz - a.nz).slice(0, 3)
  .map(({ t }) => ({ t, bytes: Buffer.from(vram.subarray(t * 32, t * 32 + 32)) }));

const idxE = loadIndex();
const hits = new Map<string, { off: number; size: number; found: { t: number; pos: number }[] }>();
for (const e of idxE) {
  try {
    const dd = fs.readFileSync(path.join('D:/blastem/snatcher/extracted', e.file));
    const dc = Buffer.from(decompressLzss(dd, e.off + 2, 0x20000));
    const sw = Buffer.alloc(dc.length);
    for (let i = 0; i + 1 < dc.length; i += 2) { sw[i] = dc[i + 1]; sw[i + 1] = dc[i]; }
    const found: { t: number; pos: number }[] = [];
    for (const p of probes) {
      const pos = sw.indexOf(p.bytes);
      if (pos >= 0 && pos % 32 === 0) found.push({ t: p.t, pos });
    }
    if (found.length) {
      const key = `${e.file}@$${e.off.toString(16)}`;
      hits.set(key, { off: e.off, size: e.size, found });
      // Full coverage check with implied base from first probe.
      const implied = found[0].t - found[0].pos / 32;
      let cov = 0;
      for (const t of missing) {
        const bo = (t - implied) * 32;
        if (bo >= 0 && bo + 32 <= sw.length && sw.subarray(bo, bo + 32).equals(Buffer.from(vram.subarray(t * 32, t * 32 + 32)))) cov++;
      }
      console.log(`  ${e.file} @$${e.off.toString(16)} (size=$${e.size.toString(16)}, ${dc.length}B): probes=${found.map(f => '$' + f.t.toString(16) + '@$' + f.pos.toString(16)).join(' ')} → impliedBase $${implied.toString(16)}, covers ${cov}/${missing.length} missing`);
    }
  } catch { }
}
if (!hits.size) console.log('  no blocks contain the missing tiles — genuinely dynamic content');
