// Hunt disc source for a scene's plane B tiles.
import fs from 'node:fs'; import path from 'node:path';
import { decompressLzss } from './lzss.ts';
import { loadIndex } from './lzss_index.ts';

const frame = parseInt(process.argv[2] ?? '0', 10);
if (!frame) { console.error('usage: hunt_plane_b.ts <frame>'); process.exit(1); }
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

// Plane B tiles + nametable
const ntB = (reg[4] & 0x07) << 13;
const used = new Set<number>();
for (let row = 0; row < 28; row++) for (let col = 0; col < 32; col++) {
  const off = ntB + (row * 32 + col) * 2;
  const w = vram[off] | (vram[off + 1] << 8);
  if ((w & 0x7ff) > 0) used.add(w & 0x7ff);
}
console.log(`f${frame} plane B: ${used.size} tiles, range $${[...used].sort((a,b)=>a-b)[0]?.toString(16)}..$${[...used].sort((a,b)=>a-b).at(-1)?.toString(16)}`);
if (used.size === 0) process.exit(0);

// Highest-variance tile
let bt = 0, bs = 0;
for (const t of used) { let nz = 0; for (let i = 0; i < 32; i++) if (vram[t * 32 + i] !== 0) nz++; if (nz > bs) { bs = nz; bt = t; } }
const raw = Buffer.from(vram.subarray(bt * 32, bt * 32 + 32));
const swp = Buffer.alloc(32);
for (let i = 0; i < 32; i += 2) { swp[i] = raw[i + 1]; swp[i + 1] = raw[i]; }
console.log(`fingerprint tile $${bt.toString(16)} (${bs}/32 nz)`);

const idxE = loadIndex();
for (const e of idxE) {
  try {
    const d = fs.readFileSync(path.join('D:/blastem/snatcher/extracted', e.file));
    const dec = Buffer.from(decompressLzss(d, e.off + 2, e.size));
    const decSwp = Buffer.alloc(dec.length);
    for (let i = 0; i + 1 < dec.length; i += 2) { decSwp[i] = dec[i + 1]; decSwp[i + 1] = dec[i]; }
    const p = decSwp.indexOf(swp);
    if (p >= 0 && p % 32 === 0) {
      const base = bt - (p / 32);
      // Coverage check
      let cov = 0;
      for (const t of used) {
        const bo = (t - base) * 32;
        if (bo < 0 || bo + 32 > decSwp.length) continue;
        if (decSwp.subarray(bo, bo + 32).equals(Buffer.from(vram.subarray(t * 32, t * 32 + 32)))) cov++;
      }
      console.log(`  PLANE-B TILES: ${e.file} @$${e.off.toString(16)} LZSS(size=$${e.size.toString(16)}, ${dec.length}B) → tile $${base.toString(16)}, coverage ${cov}/${used.size}`);
      if (cov === used.size) break;
    }
  } catch { }
}
// Nametable B
const ntBBytes = Buffer.alloc(1792);
for (let i = 0; i < 1792; i++) ntBBytes[i] = vram[ntB + i];
const ntSwp = Buffer.alloc(1792);
for (let i = 0; i + 1 < 1792; i += 2) { ntSwp[i] = ntBBytes[i + 1]; ntSwp[i + 1] = ntBBytes[i]; }
const chunk = ntSwp.subarray(200, 264);
for (const e of idxE) {
  try {
    const d = fs.readFileSync(path.join('D:/blastem/snatcher/extracted', e.file));
    const dec = Buffer.from(decompressLzss(d, e.off + 2, e.size));
    if (dec.indexOf(chunk) >= 0) {
      console.log(`  PLANE-B NAMETABLE: ${e.file} @$${e.off.toString(16)} LZSS(size=$${e.size.toString(16)})`);
      break;
    }
  } catch { }
}
