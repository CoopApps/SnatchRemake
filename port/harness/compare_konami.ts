// SIDE-BY-SIDE comparison: reference (from the capture — harness only) vs
// the port's TypeScript render, for the full Konami sequence. Produces an
// animated GIF where each frame shows [reference | port | pixel-diff],
// labelled. Purpose is to see EXACTLY where the port drifts, frame by frame.
//
//   npx tsx port/harness/compare_konami.ts
//
// Guardrail-safe: the capture-decode + reference render live ONLY here in
// port/harness/. The port's game code is called through renderScene() as a
// black box; nothing about the capture leaks into port/game/.

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { renderVdpFrame } from '../src/render/vdp.ts';
import { renderScene } from '../game/main.ts';
import { preloadAllScenes } from './preload.ts';

await preloadAllScenes();

// ---- reference-frame reconstructor ----
const STATE = path.join(import.meta.dirname, '..', 'rendered', 'intro', 'state.bin');
const buf = fs.readFileSync(STATE);
const vs = buf.readUInt32LE(10), cs = buf.readUInt32LE(14), vss = buf.readUInt32LE(18), rs = buf.readUInt32LE(22);
function makeDecoder() {
  let o = 26;
  const vram = new Uint8Array(buf.subarray(o, o + vs)); o += vs;
  const cram = new Uint8Array(buf.subarray(o, o + cs)); o += cs;
  const vsram = new Uint8Array(buf.subarray(o, o + vss)); o += vss;
  const reg = new Uint8Array(buf.subarray(o, o + rs)); o += rs;
  let cur = 0;
  const applyDelta = (dst: Uint8Array) => { const c = buf.readUInt16LE(o); o += 2; for (let i = 0; i < c; i++) { const of = buf.readUInt16LE(o); o += 2; const l = buf.readUInt16LE(o); o += 2; dst.set(buf.subarray(o, o + l), of); o += l; } };
  return {
    frameAt(target: number) {
      while (cur < target) { applyDelta(vram); applyDelta(cram); applyDelta(vsram); applyDelta(reg); cur++; }
      return renderVdpFrame(vram, cram, vsram, reg);
    },
  };
}

// ---- comparison sheet builder ----
const FROM = 1440, TO = 2240, STEP = 4;     // covers Konami sequence + fade-out
const W = 256, H = 224;
const GAP = 8;
const LABEL_H = 14;
const CELL_W = W + GAP + W + GAP + W;       // ref | port | diff
const CELL_H = H + LABEL_H;
const dec = makeDecoder();

// ---- 5x3 pixel font for labels ----
const FONT: Record<string, string[]> = {
  '0': ['111','101','101','101','111'], '1': ['010','110','010','010','111'],
  '2': ['111','001','111','100','111'], '3': ['111','001','111','001','111'],
  '4': ['101','101','111','001','001'], '5': ['111','100','111','001','111'],
  '6': ['111','100','111','101','111'], '7': ['111','001','010','010','010'],
  '8': ['111','101','111','101','111'], '9': ['111','101','111','001','111'],
  'f': ['011','010','111','010','010'], 'p': ['110','101','110','100','100'],
  'o': ['111','101','101','101','111'], 'r': ['110','101','110','101','101'],
  't': ['111','010','010','010','010'], 'd': ['110','101','101','101','110'],
  'i': ['1','1','1','1','1'],           ' ': ['00','00','00','00','00'],
};
function drawText(canvas: Uint8Array, canvasW: number, x: number, y: number, s: string, rgb: [number, number, number]) {
  let cx = x;
  for (const ch of s) {
    const g = FONT[ch] || FONT[' '];
    for (let py = 0; py < g.length; py++) for (let px = 0; px < g[py].length; px++) {
      if (g[py][px] === '1') {
        const i = ((y + py) * canvasW + (cx + px)) * 3;
        canvas[i] = rgb[0]; canvas[i + 1] = rgb[1]; canvas[i + 2] = rgb[2];
      }
    }
    cx += g[0].length + 1;
  }
}

const frames: { f: number; canvas: Uint8Array }[] = [];
for (let f = FROM; f <= TO; f += STEP) {
  const ref = dec.frameAt(f);                                // reference (from capture)
  const port = renderScene('konami_logo', f);                // port
  // Compose one row [ref | port | diff]
  const row = new Uint8Array(CELL_W * CELL_H * 3).fill(24);
  const blit = (src: { rgb: Uint8Array; width: number; height: number }, ox: number) => {
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) * 3, d = ((y + LABEL_H) * CELL_W + ox + x) * 3;
      row[d] = src.rgb[s]; row[d + 1] = src.rgb[s + 1]; row[d + 2] = src.rgb[s + 2];
    }
  };
  blit(ref, 0);
  blit(port, W + GAP);
  // diff panel: red per-pixel L1 error scaled to 255
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = (y * W + x) * 3, b = (y * port.width + x) * 3;
    const d = Math.min(255, Math.abs(ref.rgb[a] - port.rgb[b]) + Math.abs(ref.rgb[a + 1] - port.rgb[b + 1]) + Math.abs(ref.rgb[a + 2] - port.rgb[b + 2]));
    const di = ((y + LABEL_H) * CELL_W + (W + GAP + W + GAP) + x) * 3;
    row[di] = d; row[di + 1] = 255 - d; row[di + 2] = 0;
  }
  // simple text label: draw the frame number as tiny pixels
  drawText(row, CELL_W, 4, 3, `f${f}`, [200, 200, 200]);
  drawText(row, CELL_W, W + GAP + 4, 3, 'port', [180, 220, 255]);
  drawText(row, CELL_W, W + GAP + W + GAP + 4, 3, 'diff', [220, 200, 180]);
  frames.push({ f, canvas: row });
}
console.log(`built ${frames.length} comparison frames (${FROM}..${TO} step ${STEP})`);

// ---- GIF encode (global palette from all frames) ----
const palMap = new Map<number, number>(); const pal: number[] = [];
const idxFrames = frames.map(fr => {
  const idx = new Uint8Array(CELL_W * CELL_H);
  for (let i = 0; i < idx.length; i++) {
    const p = fr.canvas[i * 3], q = fr.canvas[i * 3 + 1], r = fr.canvas[i * 3 + 2];
    const key = (p << 16) | (q << 8) | r;
    let ix = palMap.get(key);
    if (ix === undefined) {
      if (pal.length < 256) { ix = pal.length; pal.push(key); palMap.set(key, ix); }
      else { let best = 0, bd = 1e9; for (let k = 0; k < pal.length; k++) { const d = Math.abs((pal[k] >> 16 & 255) - p) + Math.abs((pal[k] >> 8 & 255) - q) + Math.abs((pal[k] & 255) - r); if (d < bd) { bd = d; best = k; } } ix = best; }
    }
    idx[i] = ix;
  }
  return idx;
});
console.log(`palette: ${pal.length} colours`);

function lzw(indices: Uint8Array, minCode: number): number[] {
  const CLEAR = 1 << minCode, EOI = CLEAR + 1;
  let dict = new Map<string, number>(); let next = EOI + 1; let codeSize = minCode + 1;
  const out: number[] = []; let cur = 0, curBits = 0;
  const emit = (code: number) => { cur |= code << curBits; curBits += codeSize; while (curBits >= 8) { out.push(cur & 0xff); cur >>= 8; curBits -= 8; } };
  const reset = () => { dict = new Map(); for (let i = 0; i < CLEAR; i++) dict.set(String(i), i); next = EOI + 1; codeSize = minCode + 1; };
  reset(); emit(CLEAR);
  let w = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i]; const wc = w + ',' + c;
    if (dict.has(wc)) { w = wc; }
    else { emit(dict.get(w)!); dict.set(wc, next++); if (next > (1 << codeSize) && codeSize < 12) codeSize++; if (next >= 4096) { emit(CLEAR); reset(); } w = String(c); }
  }
  emit(dict.get(w)!); emit(EOI);
  if (curBits > 0) out.push(cur & 0xff);
  return out;
}

const bytes: number[] = [];
const push = (...b: number[]) => bytes.push(...b);
const str = (s: string) => { for (const ch of s) bytes.push(ch.charCodeAt(0)); };
str('GIF89a');
push(CELL_W & 255, CELL_W >> 8, CELL_H & 255, CELL_H >> 8);
push(0xf7, 0, 0);
for (let i = 0; i < 256; i++) { const c = pal[i] ?? 0; push(c >> 16 & 255, c >> 8 & 255, c & 255); }
push(0x21, 0xff, 0x0b); str('NETSCAPE2.0'); push(0x03, 0x01, 0xff, 0xff, 0x00);
const delay = Math.max(2, Math.round(STEP * 100 / 60));
for (const idx of idxFrames) {
  push(0x21, 0xf9, 0x04, 0x00, delay & 255, delay >> 8, 0x00, 0x00);
  push(0x2c, 0, 0, 0, 0, CELL_W & 255, CELL_W >> 8, CELL_H & 255, CELL_H >> 8, 0x00);
  const minCode = 8; push(minCode);
  const data = lzw(idx, minCode);
  for (let i = 0; i < data.length; i += 255) { const chunk = data.slice(i, i + 255); push(chunk.length, ...chunk); }
  push(0x00);
}
push(0x3b);

const OUT = 'D:/blastem/snatcher/konami_side_by_side.gif';
fs.writeFileSync(OUT, Buffer.from(bytes));
console.log(`wrote ${OUT} (${(bytes.length / 1024).toFixed(0)} KB, ${frames.length} frames, ${delay * 10}ms each)`);
