// Render a PORT scene across a frame range into an animated GIF, so we can
// watch it play. Renders port/game (capture-free) many times; no capture here.
//
//   npx tsx port/harness/animate.ts <sceneId> <from> <to> <step>

import fs from 'node:fs';
import path from 'node:path';
import { renderScene } from '../game/main.ts';
import { preloadAllScenes } from './preload.ts';

await preloadAllScenes();

const id = process.argv[2] ?? 'konami_logo';
const from = Number(process.argv[3] ?? 1480);
const to = Number(process.argv[4] ?? 1810);
const step = Number(process.argv[5] ?? 4);

// --- render frames ---
const frames: { rgb: Uint8Array; w: number; h: number }[] = [];
for (let f = from; f <= to; f += step) { const r = renderScene(id, f); frames.push({ rgb: r.rgb, w: r.width, h: r.height }); }
const W = frames[0].w, H = frames[0].h;
console.log(`rendered ${frames.length} port frames (${W}x${H}), frames ${from}..${to} step ${step}`);

// --- build a global palette (<=256) ---
const palMap = new Map<number, number>(); const pal: number[] = [];
const idxFrames: Uint8Array[] = [];
for (const fr of frames) {
  const idx = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const key = (fr.rgb[i * 3] << 16) | (fr.rgb[i * 3 + 1] << 8) | fr.rgb[i * 3 + 2];
    let p = palMap.get(key);
    if (p === undefined) {
      if (pal.length < 256) { p = pal.length; pal.push(key); palMap.set(key, p); }
      else { // nearest existing (rare — sequence has few colours)
        let best = 0, bd = 1e9; const r = fr.rgb[i * 3], g = fr.rgb[i * 3 + 1], b = fr.rgb[i * 3 + 2];
        for (let k = 0; k < pal.length; k++) { const d = Math.abs((pal[k] >> 16 & 255) - r) + Math.abs((pal[k] >> 8 & 255) - g) + Math.abs((pal[k] & 255) - b); if (d < bd) { bd = d; best = k; } }
        p = best;
      }
    }
    idx[i] = p;
  }
  idxFrames.push(idx);
}
console.log(`palette: ${pal.length} colours`);

// --- LZW (GIF) ---
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

// --- assemble GIF89a ---
const bytes: number[] = [];
const push = (...b: number[]) => bytes.push(...b);
const str = (s: string) => { for (const ch of s) bytes.push(ch.charCodeAt(0)); };
str('GIF89a');
push(W & 255, W >> 8, H & 255, H >> 8);
// packed: global color table, 256 entries (2^8), color res 8
push(0xf7, 0, 0);
for (let i = 0; i < 256; i++) { const c = pal[i] ?? 0; push(c >> 16 & 255, c >> 8 & 255, c & 255); }
// loop forever (NETSCAPE)
push(0x21, 0xff, 0x0b); str('NETSCAPE2.0'); push(0x03, 0x01, 0xff, 0xff, 0x00);
const delay = Math.max(2, Math.round(step * 100 / 60)); // 1/100s per GIF frame
for (const idx of idxFrames) {
  push(0x21, 0xf9, 0x04, 0x00, delay & 255, delay >> 8, 0x00, 0x00);   // graphic control
  push(0x2c, 0, 0, 0, 0, W & 255, W >> 8, H & 255, H >> 8, 0x00);       // image descriptor
  const minCode = 8; push(minCode);
  const data = lzw(idx, minCode);
  for (let i = 0; i < data.length; i += 255) { const chunk = data.slice(i, i + 255); push(chunk.length, ...chunk); }
  push(0x00);
}
push(0x3b);

const OUT = 'D:/blastem/snatcher/konami_port.gif';
fs.writeFileSync(OUT, Buffer.from(bytes));
console.log(`wrote ${OUT} (${(bytes.length / 1024).toFixed(0)} KB, ${frames.length} frames, ${delay * 10}ms each)`);
