// Port entry point. Renders a scene by id to an RGB frame, and (as a CLI) can
// write it to a PNG so we can look at what the PORT produced — no capture
// anywhere in this path.

import fs from 'node:fs';
import zlib from 'node:zlib';
import { sceneById, SCENES } from './scenes/registry.ts';
import type { RgbFrame } from './render/screen.ts';

export function renderScene(id: string, frame?: number): RgbFrame {
  const sc = sceneById(id);
  if (!sc) throw new Error(`no such scene: ${id}`);
  return sc.render(frame ?? sc.checkpoints[0]);
}

function crc32(b: Buffer): number { let c = ~0; for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return (~c) >>> 0; }
function pchunk(t: string, d: Buffer): Buffer { const ty = Buffer.from(t, 'latin1'); const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([ty, d])), 0); return Buffer.concat([l, ty, d, c]); }
export function toPng(f: RgbFrame): Buffer { const s = f.width * 3; const rb = Buffer.alloc((s + 1) * f.height); for (let y = 0; y < f.height; y++) { rb[y * (s + 1)] = 0; Buffer.from(f.rgb).copy(rb, y * (s + 1) + 1, y * s, y * s + s); } const idat = zlib.deflateSync(rb, { level: 9 }); const ih = Buffer.alloc(13); ih.writeUInt32BE(f.width, 0); ih.writeUInt32BE(f.height, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pchunk('IHDR', ih), pchunk('IDAT', idat), pchunk('IEND', Buffer.alloc(0))]); }

// CLI: `tsx main.ts <sceneId>` -> writes port/game/_preview_<id>.png
if (process.argv[1]?.endsWith('main.ts')) {
  const id = process.argv[2] ?? SCENES[0].id;
  const frame = process.argv[3] ? Number(process.argv[3]) : undefined;
  const f = renderScene(id, frame);
  const out = `D:/completed ai projects/structural_carver/emulator/port/game/_preview_${id}${frame ? '_' + frame : ''}.png`;
  fs.writeFileSync(out, toPng(f));
  console.log(`rendered ${id}${frame ? ' @' + frame : ''} (${f.width}x${f.height}) -> ${out}`);
}
