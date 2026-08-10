// BUILD-TIME: locate subway_corridor assets on disc. Rewritten with a better
// fingerprint (skip tiles that are mostly zeros) and try both u16 LE/BE size
// prefix + no-prefix LZSS decoding.

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

const ntBase = (reg[2] & 0x38) << 10;
const used = new Set<number>();
for (let row = 0; row < 28; row++) for (let col = 0; col < 32; col++) {
  const off = ntBase + (row * 32 + col) * 2;
  const w = vram[off] | (vram[off + 1] << 8);
  const t = w & 0x7ff; if (t > 0) used.add(t);
}

// Pick a HIGH-VARIANCE tile: skip tiles with > 8 zero bytes.
let bestTile = -1, bestScore = 0;
for (const t of used) {
  let nonZero = 0;
  for (let i = 0; i < 32; i++) if (vram[t * 32 + i] !== 0) nonZero++;
  if (nonZero > bestScore) { bestScore = nonZero; bestTile = t; }
}
console.log(`most-dense tile: $${bestTile.toString(16)} (${bestScore}/32 non-zero bytes)`);

const raw = Buffer.from(vram.subarray(bestTile * 32, bestTile * 32 + 32));
const swp = Buffer.alloc(32);
for (let i = 0; i < 32; i += 2) { swp[i] = raw[i + 1]; swp[i + 1] = raw[i]; }
console.log(`  raw:     ${raw.toString('hex')}`);
console.log(`  swapped: ${swp.toString('hex')}`);

const DISC = 'D:/blastem/snatcher/extracted';
const files = fs.readdirSync(DISC).filter(f => /\.BIN$/i.test(f));

console.log(`\n=== raw scan (both byte orders) ===`);
for (const f of files) {
  const d = fs.readFileSync(path.join(DISC, f));
  const iR = d.indexOf(raw);
  const iS = d.indexOf(swp);
  if (iR >= 0) console.log(`  RAW      in ${f} at $${iR.toString(16)}`);
  if (iS >= 0) console.log(`  SWAPPED  in ${f} at $${iS.toString(16)}`);
}

console.log(`\n=== LZSS(sizePrefix LE or BE) + LZSS(no-prefix at every 4B offset) ===`);
let hits = 0;
for (const f of files) {
  const d = fs.readFileSync(path.join(DISC, f));
  const cap = Math.min(d.length, 0x40000);
  for (let off = 0; off + 4 < cap; off += 2) {
    const szLE = d[off] | (d[off + 1] << 8);
    const szBE = (d[off] << 8) | d[off + 1];
    for (const [label, delta, sz] of [
      ['LZSS-LE', 2, szLE],
      ['LZSS-BE', 2, szBE],
      ['LZSS-raw', 0, 32000],
    ] as const) {
      if (sz < 0x200 || sz > 0x20000) continue;
      try {
        const dec = Buffer.from(decompressLzss(d, off + delta, sz));
        if (dec.length < 64) continue;
        if (dec.indexOf(raw) >= 0 || dec.indexOf(swp) >= 0) {
          const which = dec.indexOf(raw) >= 0 ? 'RAW' : 'SWAPPED';
          console.log(`  ${f} @$${off.toString(16)} ${label}(size=$${sz.toString(16)}) → ${dec.length}B, ${which} target`);
          hits++;
          if (hits > 4) break;
        }
      } catch { }
    }
    if (hits > 4) break;
  }
  if (hits > 4) break;
}
if (hits === 0) console.log('  no LZSS matches at any offset/order — needs Ghidra work');
