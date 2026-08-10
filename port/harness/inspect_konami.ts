// DEV INSPECTION (harness side — reads the capture to UNDERSTAND, so we can
// author the port scene). Dissects how frame 1600 composes the Konami logo:
// which plane, which nametable cells, which tiles (and do they match disc
// $15A0?), and which palette line is the blue.

import fs from 'node:fs';
import path from 'node:path';
import { decompressLzss } from '../game/assets/lzss.ts';
import { discFile } from '../game/assets/disc.ts';

const STATE = path.join(import.meta.dirname, '..', 'rendered', 'intro', 'state.bin');
function stateAt(target: number) {
  const buf = fs.readFileSync(STATE);
  const vs = buf.readUInt32LE(10), cs = buf.readUInt32LE(14), vss = buf.readUInt32LE(18), rs = buf.readUInt32LE(22);
  let o = 26; const vram = new Uint8Array(buf.subarray(o, o + vs)); o += vs; const cram = new Uint8Array(buf.subarray(o, o + cs)); o += cs; const vsram = new Uint8Array(buf.subarray(o, o + vss)); o += vss; const reg = new Uint8Array(buf.subarray(o, o + rs)); o += rs;
  const ad = (d: Uint8Array) => { const c = buf.readUInt16LE(o); o += 2; for (let i = 0; i < c; i++) { const of = buf.readUInt16LE(o); o += 2; const l = buf.readUInt16LE(o); o += 2; d.set(buf.subarray(o, o + l), of); o += l; } };
  for (let f = 1; f <= target; f++) { ad(vram); ad(cram); ad(vsram); ad(reg); }
  return { vram, cram, reg };
}

const { vram, cram, reg } = stateAt(1600);
const rd16 = (b: Uint8Array, a: number) => (b[a] << 8) | b[a + 1];
const planeA = (reg[2] & 0x38) << 10, planeB = (reg[4] & 0x07) << 13;
const pw = [32, 64, 32, 128][reg[16] & 3] ?? 64, ph = [32, 32, 64, 128][(reg[16] >> 4) & 3] ?? 32;
console.log(`planeA=$${planeA.toString(16)} planeB=$${planeB.toString(16)} size ${pw}x${ph}`);

// For each plane, collect distinct (tileIndex, paletteLine) used, and the used rows/cols.
for (const [name, base] of [['A', planeA], ['B', planeB]] as const) {
  const tiles = new Map<number, number>(); let minR = 99, maxR = -1, minC = 99, maxC = -1, cells = 0;
  for (let r = 0; r < ph; r++) for (let c = 0; c < pw; c++) {
    const e = rd16(vram, base + (r * pw + c) * 2); const tile = e & 0x7ff, pal = (e >> 13) & 3;
    if (tile !== 0) { cells++; tiles.set(tile, pal); if (r < minR) minR = r; if (r > maxR) maxR = r; if (c < minC) minC = c; if (c > maxC) maxC = c; }
  }
  if (!cells) { console.log(`plane ${name}: empty`); continue; }
  const ts = [...tiles.keys()].sort((a, b) => a - b);
  const pals = new Set(tiles.values());
  console.log(`plane ${name}: ${cells} cells, rows ${minR}..${maxR} cols ${minC}..${maxC}, ${ts.length} distinct tiles [${ts[0].toString(16)}..${ts[ts.length - 1].toString(16)}], palette line(s) {${[...pals].join(',')}}`);
}

// Do the DISC $15A0 tiles match VRAM tile bytes (as-is or byte-swapped)?
const disc = decompressLzss(discFile('MAINCPU_IP.BIN'), 0x15a0, 4864);
const swap = (b: Uint8Array) => { const o = new Uint8Array(b.length); for (let i = 0; i + 1 < b.length; i += 2) { o[i] = b[i + 1]; o[i + 1] = b[i]; } return o; };
const v = Buffer.from(vram);
const probe = 0x300; // mid tile, non-blank
console.log(`\ndisc $15A0 tiles: as-is in VRAM @ ${v.indexOf(Buffer.from(disc.subarray(probe, probe + 64)))}, swapped @ ${v.indexOf(Buffer.from(swap(disc).subarray(probe, probe + 64)))}`);
console.log(`(if swapped found at 0xN, the logo tiles live at VRAM 0xN-0x${probe.toString(16)}, i.e. tile index that/0x20)`);

// Dump the 4 CRAM palette lines as RGB so we can see which is the blue logo.
console.log('\nCRAM palette lines (RGB):');
for (let line = 0; line < 4; line++) {
  const cols: string[] = [];
  for (let i = 0; i < 16; i++) { const w = rd16(cram, (line * 16 + i) * 2); const r = ((w & 0x00e) >> 1) * 36, g = ((w & 0x0e0) >> 5) * 36, b = ((w & 0xe00) >> 9) * 36; cols.push(`${r},${g},${b}`); }
  console.log(`  line ${line}: ${cols.slice(0, 6).join(' | ')} ...`);
}
