// DEV TOOL: extract the RSS credit's nametable layout.
import fs from 'node:fs';
import path from 'node:path';
import { decompressLzss } from '../game/assets/lzss.ts';

const S = path.join(import.meta.dirname, '..', 'rendered', 'intro', 'state.bin');
const buf = fs.readFileSync(S);
const vs = buf.readUInt32LE(10), cs = buf.readUInt32LE(14), vss = buf.readUInt32LE(18), rs = buf.readUInt32LE(22);
let o = 26; const vram = new Uint8Array(buf.subarray(o, o + vs)); o += vs; const cram = new Uint8Array(buf.subarray(o, o + cs)); o += cs; const vsram = new Uint8Array(buf.subarray(o, o + vss)); o += vss; const reg = new Uint8Array(buf.subarray(o, o + rs)); o += rs;
const ad = (d: Uint8Array) => { const c = buf.readUInt16LE(o); o += 2; for (let i = 0; i < c; i++) { const of = buf.readUInt16LE(o); o += 2; const l = buf.readUInt16LE(o); o += 2; d.set(buf.subarray(o, o + l), of); o += l; } };
for (let f = 1; f <= 4100; f++) { ad(vram); ad(cram); ad(vsram); ad(reg); }

const rd16le = (b: Uint8Array, a: number) => b[a] | (b[a + 1] << 8);
const d1 = new Uint8Array(fs.readFileSync('D:/blastem/snatcher/extracted/DATA_D1.BIN'));
const rssBytes = Buffer.from(decompressLzss(d1, 0xc31c + 2, 0x10000));
// The block has a header (601 bytes) before the raw tile stream; tile N
// starts at byte offset TILE_BASE + N*32 (verified by matching multiple VRAM
// tiles and seeing linear +32-per-VRAM-tile-index).
const TILE_BASE = 601;

function vramTileToRssIdx(vramIdx: number): number {
  const need = Buffer.alloc(32); for (let i = 0; i + 1 < 32; i += 2) { need[i] = vram[vramIdx * 32 + i + 1]; need[i + 1] = vram[vramIdx * 32 + i]; }
  const at = rssBytes.indexOf(need);
  if (at < TILE_BASE) return -1;
  const idx = at - TILE_BASE;
  if (idx % 32 !== 0) return -1;
  return idx / 32;
}

const planeA = (reg[2] & 0x38) << 10;
interface Cell { c: number; r: number; tile: number; pal: number; hf: number; vf: number; }
const cells: Cell[] = [];
let minR = 99, maxR = -1, minC = 99, maxC = -1, missing = 0;
for (let r = 0; r < 28; r++) for (let c = 0; c < 32; c++) {
  const e = rd16le(vram, planeA + (r * 32 + c) * 2); const t = e & 0x7ff;
  if (t === 0) continue;
  const idx = vramTileToRssIdx(t);
  if (idx < 0) { missing++; continue; }
  cells.push({ c, r, tile: idx, pal: (e >> 13) & 3, hf: (e >> 11) & 1, vf: (e >> 12) & 1 });
  if (r < minR) minR = r; if (r > maxR) maxR = r; if (c < minC) minC = c; if (c > maxC) maxC = c;
}
console.log(`RSS: ${cells.length} cells (${missing} missing), bbox rows ${minR}..${maxR} cols ${minC}..${maxC}`);
const layout = { source: 'DATA_D1.BIN $C31C (LZSS)', originCol: minC, originRow: minR, w: maxC - minC + 1, h: maxR - minR + 1, cells: cells.map(x => ({ c: x.c - minC, r: x.r - minR, tile: x.tile, pal: x.pal, hf: x.hf, vf: x.vf })) };
const out = path.join(import.meta.dirname, '..', 'game', 'scenes', 'data', 'rss.layout.json');
fs.writeFileSync(out, JSON.stringify(layout));
console.log(`wrote ${out}`);
