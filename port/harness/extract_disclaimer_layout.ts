// DEV TOOL (harness): extract the disclaimer's tilemap from frame 3160.
// Uses the capture only to READ the layout the game's code produced, then
// the port draws it from the ported disc tiles. Same pattern as Konami.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decompressLzss } from '../game/assets/lzss.ts';

const S = path.join(import.meta.dirname, '..', 'rendered', 'intro', 'state.bin');
const buf = fs.readFileSync(S);
const vs = buf.readUInt32LE(10), cs = buf.readUInt32LE(14), vss = buf.readUInt32LE(18), rs = buf.readUInt32LE(22);
let o = 26; const vram = new Uint8Array(buf.subarray(o, o + vs)); o += vs; const cram = new Uint8Array(buf.subarray(o, o + cs)); o += cs; const vsram = new Uint8Array(buf.subarray(o, o + vss)); o += vss; const reg = new Uint8Array(buf.subarray(o, o + rs)); o += rs;
const ad = (d: Uint8Array) => { const c = buf.readUInt16LE(o); o += 2; for (let i = 0; i < c; i++) { const of = buf.readUInt16LE(o); o += 2; const l = buf.readUInt16LE(o); o += 2; d.set(buf.subarray(o, o + l), of); o += l; } };
for (let f = 1; f <= 3400; f++) { ad(vram); ad(cram); ad(vsram); ad(reg); } // hold phase — full brightness

const rd16le = (b: Uint8Array, a: number) => b[a] | (b[a + 1] << 8);

// Match the port's font tiles (from DATA_D1 $ADA6) to the VRAM tile indices
// the game wrote, so the port can look up "which font index is at cell (c,r)".
const d1 = new Uint8Array(fs.readFileSync('D:/blastem/snatcher/extracted/DATA_D1.BIN'));
const fontBytes = decompressLzss(d1, 0xada6 + 2, 0x2000);
const fontTiles: Buffer[] = [];
for (let t = 0; t + 32 <= fontBytes.length; t += 32) fontTiles.push(Buffer.from(fontBytes.subarray(t, t + 32)));

// VRAM tile -> font-tile index (in DATA_D1's decompressed order)
function vramTileToFontIdx(vramIdx: number): number {
  const need = Buffer.alloc(32);
  for (let i = 0; i + 1 < 32; i += 2) { need[i] = vram[vramIdx * 32 + i + 1]; need[i + 1] = vram[vramIdx * 32 + i]; }
  for (let i = 0; i < fontTiles.length; i++) if (fontTiles[i].equals(need)) return i;
  return -1;
}

const planeA = (reg[2] & 0x38) << 10;
interface Cell { c: number; r: number; font: number; pal: number; hf: number; vf: number; }
const cells: Cell[] = [];
let minR = 99, maxR = -1, minC = 99, maxC = -1;
for (let r = 0; r < 28; r++) for (let c = 0; c < 32; c++) {
  const e = rd16le(vram, planeA + (r * 32 + c) * 2);
  const t = e & 0x7ff;
  if (t === 0) continue;
  const font = vramTileToFontIdx(t);
  if (font < 0) continue;
  cells.push({ c, r, font, pal: (e >> 13) & 3, hf: (e >> 11) & 1, vf: (e >> 12) & 1 });
  if (r < minR) minR = r; if (r > maxR) maxR = r;
  if (c < minC) minC = c; if (c > maxC) maxC = c;
}
console.log(`disclaimer: ${cells.length} cells, bbox rows ${minR}..${maxR} cols ${minC}..${maxC}`);

// Save layout
const layout = {
  source: 'DATA_D1.BIN $ADA6 (LZSS)',
  originCol: minC, originRow: minR,
  w: maxC - minC + 1, h: maxR - minR + 1,
  cells: cells.map(x => ({ c: x.c - minC, r: x.r - minR, font: x.font, pal: x.pal, hf: x.hf, vf: x.vf })),
};
const out = path.join(import.meta.dirname, '..', 'game', 'scenes', 'data', 'disclaimer.layout.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(layout));
console.log(`wrote ${out}`);

// Also dump the visible palette (frame 3400) so we have the disc-authored
// values to compare against when we find them on disc later.
function packedToGen(lo: number, hi: number): number { const p = lo | (hi << 8); const r = p & 7, g = (p >> 3) & 7, b = (p >> 6) & 7; return (b << 9) | (g << 5) | (r << 1); }
const line0 = Array.from({ length: 16 }, (_, i) => packedToGen(cram[i * 2], cram[i * 2 + 1]));
console.log(`palette line 0 (Genesis 0BGR): ${line0.map(w => '0x' + w.toString(16).padStart(4, '0')).join(' ')}`);
