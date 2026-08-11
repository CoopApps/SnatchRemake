// Cel exporter — builds a scene's animation bundle from disc, in a format both the
// TypeScript engine and a future editor consume. Build-time only (touches disc +
// the capture-as-identification-oracle); emits self-contained cels.
//
// Output per scene:
//   <scene>/palette.json        disc-decoded RGB (4 lines x 16)  + palette.manifest.json
//   <scene>/cels/<id>.tiles.bin  the cel's OWN tiles (4bpp, 32B each, column-major per sprite)
//   <scene>/cels.json            [{ id, origin, sprites:[{tileBase,pal,hf,vf,w,h,dx,dy}] }]
//   <scene>/manifest.json        provenance (disc file + descriptor offsets + frames)
//
// A cel's sprite.tileBase indexes into that cel's own tiles.bin; each sprite's
// w*h tiles are stored consecutively column-major, so engine.drawSprite works
// directly. The tileset is per-tile disc-sourced (each tile = the disc tile that
// matches what the hardware displayed for that keyframe).

import fs from 'node:fs'; import path from 'node:path';

const EXPORTED = 'D:/completed ai projects/structural_carver/emulator/port/exported';
const CAPTURE  = 'D:/completed ai projects/structural_carver/emulator/port/rendered/intro/state.bin';
const DISC     = 'D:/blastem/snatcher/extracted';

// ---- disc tile content -> decoded 4bpp tile bytes (32B), keyed by content hash ----
function buildDiscTileMap() {
  const idx = JSON.parse(fs.readFileSync(EXPORTED + '/tiles_index.json', 'utf8'));
  const map = new Map();
  for (const s of idx) {
    const f = EXPORTED + '/tiles/' + s.file.replace(/\.bin$/i, '') + '_' + s.off.toString(16) + '.bin';
    const d = fs.readFileSync(f);
    for (let t = 0; t * 32 + 32 <= d.length; t++) {
      const raw = d.subarray(t * 32, t * 32 + 32);
      const h = raw.toString('hex');
      if (!map.has(h)) map.set(h, Buffer.from(raw));
    }
  }
  return map;
}

// ---- capture replay (identification oracle only) ----
function openCapture() {
  const buf = fs.readFileSync(CAPTURE);
  const vs = buf.readUInt32LE(10), cs = buf.readUInt32LE(14), vss = buf.readUInt32LE(18), rs = buf.readUInt32LE(22);
  let o = 26; const vram = new Uint8Array(buf.subarray(o, o + vs)); o = 26 + vs + cs + vss + rs;
  const ad = () => { let c = buf.readUInt16LE(o); o += 2; for (let i = 0; i < c; i++) { const of = buf.readUInt16LE(o); o += 2; const l = buf.readUInt16LE(o); o += 2; vram.set(buf.subarray(o, o + l), of); o += l; }
    for (let k = 0; k < 3; k++) { c = buf.readUInt16LE(o); o += 2; for (let i = 0; i < c; i++) { o += 2; const l = buf.readUInt16LE(o); o += 2; o += l; } } };
  return { vram, ad };
}
const satAttrs = vram => { const SAT = 0xfe00; let idx = 0; const s = new Set(); const seen = new Set();
  for (let c = 0; c < 80; c++) { if (seen.has(idx)) break; seen.add(idx); const off = SAT + idx * 8; s.add(vram[off + 4] | (vram[off + 5] << 8)); const lk = vram[off + 2]; if (lk === 0) break; idx = lk; } return s; };

const be16 = (d, a) => (d[a] << 8) | d[a + 1];
const sbe16 = (d, a) => { const v = be16(d, a); return v & 0x8000 ? v - 0x10000 : v; };

// enumerate descriptor lists in a region: runs of valid [Yoff,basePos,attr,Xoff] records
function enumerateCels(disc, lo, hi) {
  const valid = a => { const bp = be16(disc, a + 2), sz = bp >> 8, lk = bp & 0xff; if (sz < 1 || sz > 0xf || lk !== 0) return false; const xo = sbe16(disc, a + 6), yo = sbe16(disc, a); return Math.abs(xo) <= 200 && Math.abs(yo) <= 200; };
  const lists = []; let a = lo;
  while (a < hi) { if (valid(a)) { const base = a; let n = 0; while (a < hi && valid(a)) { n++; a += 8; } if (n >= 4) lists.push({ base, n }); } else a += 2; }
  return lists;
}

export function exportScene({ sceneId, discFile, celRegion, paletteOffsets, origins, outDir }) {
  const disc = new Uint8Array(fs.readFileSync(path.join(DISC, discFile)));
  const discMap = buildDiscTileMap();
  const cels = enumerateCels(disc, celRegion[0], celRegion[1]);
  // PASS 1: display frame per cel (via SAT attr match)
  const attrsOf = c => { const s = new Set(); for (let i = 0; i < c.n; i++) { const at = be16(disc, c.base + i * 8 + 4); if (at & 0x7ff) s.add(at); } return s; };
  const want = cels.map(attrsOf);
  let cap = openCapture(); const best = cels.map(() => ({ m: 0, frame: 0 }));
  for (let f = 1; f < 40000; f++) { try { cap.ad(); } catch { break; } if (f % 2) continue; const sa = satAttrs(cap.vram);
    cels.forEach((c, i) => { let m = 0; for (const at of want[i]) if (sa.has(at)) m++; if (m > best[i].m) best[i] = { m, frame: f }; }); }
  const shown = cels.map((c, i) => ({ ...c, frame: best[i].frame, m: best[i].m, want: want[i] })).filter(c => c.m >= c.want.size && c.want.size > 0);
  // PASS 2: at each display frame, per-tile-source the cel's tiles from disc
  const frames = [...new Set(shown.map(c => c.frame))].sort((a, b) => a - b);
  cap = openCapture(); let cur = 0;
  const outCels = []; fs.mkdirSync(path.join(outDir, 'cels'), { recursive: true });
  for (const tf of frames) {
    while (cur < tf) { cur++; try { cap.ad(); } catch { break; } }
    const vram = cap.vram;
    const discTileAt = vi => { const t = Buffer.alloc(32); for (let j = 0; j < 32; j++) t[j] = vram[(vi * 32 + j) ^ 1]; return discMap.get(t.toString('hex')); };
    for (const c of shown.filter(s => s.frame === tf)) {
      const origin = origins[c.base] || origins.default || { x: 48, y: 72 };
      const sprites = []; const tileBufs = []; let missing = 0;
      for (let i = 0; i < c.n; i++) {
        const a = c.base + i * 8; const Yoff = sbe16(disc, a), sz = be16(disc, a + 2) >> 8, attr = be16(disc, a + 4), Xoff = sbe16(disc, a + 6);
        const tile = attr & 0x7ff; if (!tile) continue; const w = ((sz >> 2) & 3) + 1, h = (sz & 3) + 1;
        const tileBase = tileBufs.length;
        for (let col = 0; col < w; col++) for (let row = 0; row < h; row++) { const dt = discTileAt((tile + col * h + row) & 0x7ff); if (dt) tileBufs.push(dt); else { tileBufs.push(Buffer.alloc(32)); missing++; } }
        sprites.push({ tileBase, pal: (attr >> 13) & 3, hf: !!((attr >> 11) & 1), vf: !!((attr >> 12) & 1), w, h, dx: Xoff, dy: Yoff });
      }
      if (!sprites.length) continue;
      const id = `${sceneId}_${c.base.toString(16)}`;
      fs.writeFileSync(path.join(outDir, 'cels', id + '.tiles.bin'), Buffer.concat(tileBufs));
      outCels.push({ id, origin, sprites, source: { file: discFile, off: '0x' + c.base.toString(16), frame: tf, missingTiles: missing } });
    }
  }
  // palette (disc-sourced) + manifest
  const DAC = [0, 33, 66, 99, 140, 173, 206, 239];
  const palette = paletteOffsets.map(off => { const line = []; for (let e = 0; e < 16; e++) { const w = be16(disc, off + e * 2); line.push({ r: DAC[(w >> 1) & 7], g: DAC[(w >> 5) & 7], b: DAC[(w >> 9) & 7] }); } return line; });
  fs.writeFileSync(path.join(outDir, 'palette.json'), JSON.stringify(palette));
  fs.writeFileSync(path.join(outDir, 'cels.json'), JSON.stringify(outCels, null, 1));
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ sceneId, discFile, celRegion: celRegion.map(x => '0x' + x.toString(16)), paletteOffsets: paletteOffsets.map(x => '0x' + x.toString(16)), cels: outCels.length }, null, 2));
  return { cels: outCels.length, totalTiles: outCels.reduce((a, c) => a + c.sprites.reduce((b, s) => b + s.w * s.h, 0), 0) };
}
