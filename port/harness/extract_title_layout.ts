// DEV TOOL: extract the SNATCHER title screen's nametable layout, matching
// each VRAM tile the game uploaded to its disc source across the 6 LZSS blocks
// that DATA_D2.BIN carries for this scene. Writes the layout JSON the port scene
// consumes at runtime.

import fs from 'node:fs';
import path from 'node:path';
import { decompressLzss } from '../game/assets/lzss.ts';

const S = path.join(import.meta.dirname, '..', 'rendered', 'intro', 'state.bin');
const buf = fs.readFileSync(S);
const vs = buf.readUInt32LE(10), cs = buf.readUInt32LE(14), vss = buf.readUInt32LE(18), rs = buf.readUInt32LE(22);
let o = 26; const vram = new Uint8Array(buf.subarray(o, o + vs)); o += vs; const cram = new Uint8Array(buf.subarray(o, o + cs)); o += cs; const vsram = new Uint8Array(buf.subarray(o, o + vss)); o += vss; const reg = new Uint8Array(buf.subarray(o, o + rs)); o += rs;
const ad = (d: Uint8Array) => { const c = buf.readUInt16LE(o); o += 2; for (let i = 0; i < c; i++) { const of = buf.readUInt16LE(o); o += 2; const l = buf.readUInt16LE(o); o += 2; d.set(buf.subarray(o, o + l), of); o += l; } };
for (let f = 1; f <= 2660; f++) { ad(vram); ad(cram); ad(vsram); ad(reg); } // clean title (before options menu overlay in the capture)

const rd16le = (b: Uint8Array, a: number) => b[a] | (b[a + 1] << 8);

// The 6 disc blocks that together supply the title tiles (traced in the harness).
const BLOCKS = [
  { name: 'A', off: 0x19ee }, { name: 'B', off: 0x3164 }, { name: 'C', off: 0x4a70 },
  { name: 'D', off: 0x667c }, { name: 'E', off: 0x6afe }, { name: 'F', off: 0x81f8 },
];
const d2 = new Uint8Array(fs.readFileSync('D:/blastem/snatcher/extracted/DATA_D2.BIN'));
const pool: { block: string; idx: number; bytes: Buffer }[] = [];
for (const b of BLOCKS) {
  const bytes = decompressLzss(d2, b.off + 2, 0x10000);
  for (let t = 0; t + 32 <= bytes.length; t += 32) pool.push({ block: b.name, idx: t / 32, bytes: Buffer.from(bytes.subarray(t, t + 32)) });
}
console.log(`pool: ${pool.length} tiles from ${BLOCKS.length} blocks`);

// Map VRAM tile -> pool position [blockName, indexInBlock]
function vramTileBytes(t: number): Buffer { const b = Buffer.alloc(32); for (let i = 0; i + 1 < 32; i += 2) { b[i] = vram[t * 32 + i + 1]; b[i + 1] = vram[t * 32 + i]; } return b; }
function findInPool(bytes: Buffer): { block: string; idx: number } | null {
  for (const p of pool) if (p.bytes.equals(bytes)) return { block: p.block, idx: p.idx };
  return null;
}

const planeA = (reg[2] & 0x38) << 10;
interface Cell { c: number; r: number; block: string; tile: number; pal: number; hf: number; vf: number; }
const cells: Cell[] = []; const missing = new Set<number>();
for (let r = 0; r < 28; r++) for (let c = 0; c < 32; c++) {
  const e = rd16le(vram, planeA + (r * 32 + c) * 2);
  const t = e & 0x7ff;
  if (t === 0) continue;
  const src = findInPool(vramTileBytes(t));
  if (!src) { missing.add(t); continue; }
  cells.push({ c, r, block: src.block, tile: src.idx, pal: (e >> 13) & 3, hf: (e >> 11) & 1, vf: (e >> 12) & 1 });
}
console.log(`${cells.length} cells matched, ${missing.size} missing tiles: ${[...missing].map(t=>'0x'+t.toString(16)).slice(0,10).join(',')}`);

const layout = {
  source: 'DATA_D2.BIN LZSS blocks: ' + BLOCKS.map(b => `${b.name}@$${b.off.toString(16)}`).join(', '),
  originCol: 0, originRow: 0, w: 32, h: 28,
  cells,
};
const out = path.join(import.meta.dirname, '..', 'game', 'scenes', 'data', 'title.layout.json');
fs.writeFileSync(out, JSON.stringify(layout));
console.log(`wrote ${out}`);
