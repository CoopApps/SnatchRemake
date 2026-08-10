// DEV DEBUG: isolate where my renderer diverges from the working vdp.ts.
// Render frame 1660 two ways and compare:
//   A = vdp.ts (known-good)
//   B = my Screen renderer, fed tiles+palette+nametable pulled from the SAME
//       VRAM/CRAM (un-swapped). If A==B, my renderer is correct and the bug is
//       in disc-sourcing/mapping. If A!=B, my renderer or tile-decode is wrong.

import fs from 'node:fs';
import path from 'node:path';
import { renderVdpFrame, readCramRgb } from '../src/render/vdp.ts';
import { Screen } from '../game/render/screen.ts';
import { tilesFromBytes } from '../game/assets/graphics.ts';

const S = path.join(import.meta.dirname, '..', 'rendered', 'intro', 'state.bin');
const buf = fs.readFileSync(S);
const vs = buf.readUInt32LE(10), cs = buf.readUInt32LE(14), vss = buf.readUInt32LE(18), rs = buf.readUInt32LE(22);
let o = 26; const vram = new Uint8Array(buf.subarray(o, o + vs)); o += vs; const cram = new Uint8Array(buf.subarray(o, o + cs)); o += cs; const vsram = new Uint8Array(buf.subarray(o, o + vss)); o += vss; const reg = new Uint8Array(buf.subarray(o, o + rs)); o += rs;
const ad = (d: Uint8Array) => { const c = buf.readUInt16LE(o); o += 2; for (let i = 0; i < c; i++) { const of = buf.readUInt16LE(o); o += 2; const l = buf.readUInt16LE(o); o += 2; d.set(buf.subarray(o, o + l), of); o += l; } };
for (let f = 1; f <= 1660; f++) { ad(vram); ad(cram); ad(vsram); ad(reg); }

const ref = renderVdpFrame(vram, cram, vsram, reg);

// B: my renderer. Un-swap VRAM (vdp stores byte-swapped) then decode tiles.
const unswapped = new Uint8Array(vram.length);
for (let i = 0; i + 1 < vram.length; i += 2) { unswapped[i] = vram[i + 1]; unswapped[i + 1] = vram[i]; }
const tiles = tilesFromBytes(unswapped);           // 2048 tiles decoded from VRAM
const rd16 = (b: Uint8Array, a: number) => (b[a] << 8) | b[a + 1];
// palettes from CRAM (the SAME converter vdp.ts uses)
const pals = [0, 1, 2, 3].map(line => Array.from({ length: 16 }, (_, i) => { const [r, g, b] = readCramRgb(cram, line, i); return { r, g, b }; }));

const screen = new Screen(ref.width, ref.height);
const bg = pals[reg[7] >> 4 & 3][reg[7] & 0xf]; screen.clear(bg);
const planeB = (reg[4] & 0x07) << 13, planeA = (reg[2] & 0x38) << 10, PW = 64;
for (const [base, opaque] of [[planeB, true], [planeA, false]] as const) {
  for (let r = 0; r < 28; r++) for (let c = 0; c < 32; c++) {
    const e = rd16(vram, base + (r * PW + c) * 2); const tile = e & 0x7ff; if (tile === 0 && !opaque) continue;
    screen.drawTile(tiles[tile], c * 8, r * 8, pals[(e >> 13) & 3], { flipH: !!((e >> 11) & 1), flipV: !!((e >> 12) & 1), opaque0: opaque && ((e & 0x7ff) !== 0) });
  }
}

let close = 0, total = ref.width * ref.height;
for (let i = 0; i < total; i++) { const d = Math.abs(ref.rgb[i * 3] - screen.rgb[i * 3]) + Math.abs(ref.rgb[i * 3 + 1] - screen.rgb[i * 3 + 1]) + Math.abs(ref.rgb[i * 3 + 2] - screen.rgb[i * 3 + 2]); if (d <= 24) close++; }
console.log(`my renderer vs vdp.ts on identical VRAM/CRAM data: ${(close / total * 100).toFixed(1)}% pixel match`);
console.log(close / total > 0.98 ? '  => MY RENDERER IS CORRECT. bug is in disc tile-sourcing / mapping.' : '  => MY RENDERER/DECODE IS WRONG. fix that first.');
// dump B for eyeballing
import zlib from 'node:zlib';
function png(rgb: Uint8Array, w: number, h: number) { const s = w * 3; const rb = Buffer.alloc((s + 1) * h); for (let y = 0; y < h; y++) { rb[y * (s + 1)] = 0; Buffer.from(rgb).copy(rb, y * (s + 1) + 1, y * s, y * s + s); } const c = (t: string, d: Buffer) => { const ty = Buffer.from(t); const L = Buffer.alloc(4); L.writeUInt32BE(d.length); let cr = ~0; const all = Buffer.concat([ty, d]); for (let i = 0; i < all.length; i++) { cr ^= all[i]; for (let k = 0; k < 8; k++) cr = (cr >>> 1) ^ (0xEDB88320 & -(cr & 1)); } const C = Buffer.alloc(4); C.writeUInt32BE((~cr) >>> 0); return Buffer.concat([L, ty, d, C]); }; const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), c('IHDR', ih), c('IDAT', zlib.deflateSync(rb)), c('IEND', Buffer.alloc(0))]); }
fs.writeFileSync(path.join(import.meta.dirname, 'debug_mine.png'), png(screen.rgb, ref.width, ref.height));
console.log('  wrote debug_mine.png');
