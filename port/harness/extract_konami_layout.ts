// DEV TOOL (harness): extract the Konami logo tilemap + disc-tile mapping from
// the capture, so the port scene can embed it as authored source data. Uses the
// capture to UNDERSTAND; the running port never reads it.

import fs from 'node:fs';
import path from 'node:path';
import { decompressLzss } from '../game/assets/lzss.ts';

const S = path.join(import.meta.dirname, '..', 'rendered', 'intro', 'state.bin');
const buf = fs.readFileSync(S);
const vs = buf.readUInt32LE(10), cs = buf.readUInt32LE(14), vss = buf.readUInt32LE(18), rs = buf.readUInt32LE(22);
let o = 26; const vram = new Uint8Array(buf.subarray(o, o + vs)); o += vs; const cram = new Uint8Array(buf.subarray(o, o + cs)); o += cs; const vsram = new Uint8Array(buf.subarray(o, o + vss)); o += vss; const reg = new Uint8Array(buf.subarray(o, o + rs)); o += rs;
const ad = (d: Uint8Array) => { const c = buf.readUInt16LE(o); o += 2; for (let i = 0; i < c; i++) { const of = buf.readUInt16LE(o); o += 2; const l = buf.readUInt16LE(o); o += 2; d.set(buf.subarray(o, o + l), of); o += l; } };
const TARGET = 1660;
for (let f = 1; f <= TARGET; f++) { ad(vram); ad(cram); ad(vsram); ad(reg); }
const rd16 = (b: Uint8Array, a: number) => b[a] | (b[a + 1] << 8);  // little-endian: GPGX VRAM is byte-swapped

const disc = decompressLzss(new Uint8Array(fs.readFileSync('D:/blastem/snatcher/extracted/MAINCPU_IP.BIN')), 0x15a0, 4864);
const discSwapped: Buffer[] = [];
for (let t = 0; t + 32 <= disc.length; t += 32) { const b = Buffer.alloc(32); for (let i = 0; i + 1 < 32; i += 2) { b[i] = disc[t + i + 1]; b[i + 1] = disc[t + i]; } discSwapped.push(b); }
const discIndexOf = (vb: Buffer) => { for (let i = 0; i < discSwapped.length; i++) if (discSwapped[i].equals(vb)) return i; return -1; };

const base = 0xc000, PW = 64, PH = 32;
let minR = 99, maxR = -1, minC = 99, maxC = -1;
for (let r = 0; r < PH; r++) for (let c = 0; c < PW; c++) if ((rd16(vram, base + (r * PW + c) * 2) & 0x7ff) !== 0) { if (r < minR) minR = r; if (r > maxR) maxR = r; if (c < minC) minC = c; if (c > maxC) maxC = c; }
console.log(`logo bbox rows ${minR}..${maxR} cols ${minC}..${maxC} (${maxC - minC + 1}x${maxR - minR + 1})`);

const distinct = new Set<number>(); const cells: any[] = [];
for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) { const e = rd16(vram, base + (r * PW + c) * 2); const tile = e & 0x7ff; if (tile === 0) continue; distinct.add(tile); cells.push({ c: c - minC, r: r - minR, tile, pal: (e >> 13) & 3, hf: (e >> 11) & 1, vf: (e >> 12) & 1 }); }
let mapped = 0; const tmap: Record<number, number> = {};
for (const t of distinct) { const di = discIndexOf(Buffer.from(vram.subarray(t * 0x20, t * 0x20 + 32))); tmap[t] = di; if (di >= 0) mapped++; }
console.log(`${distinct.size} distinct tiles: ${mapped} map to disc $15A0, ${distinct.size - mapped} elsewhere`);

const out = { originCol: minC, originRow: minR, w: maxC - minC + 1, h: maxR - minR + 1, cells, tileToDisc: tmap };
fs.writeFileSync(path.join(import.meta.dirname, 'konami_layout.json'), JSON.stringify(out));
console.log(`wrote konami_layout.json (${cells.length} cells)`);
