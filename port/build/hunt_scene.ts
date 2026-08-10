// BUILD-TIME reusable disc hunter. Given a frame number, dumps VRAM at that
// frame from the reference (ORACLE USE — bytes never ship in the port; they
// only guide the disc lookup), then finds:
//   - the LZSS tile block containing the scene's tiles
//   - the palette line 0 bytes (plain BE on disc)
//   - the LZSS nametable block
// Prints a scenes.ts entry ready to paste. Used to add real-ported scenes.
//
//   npx tsx port/build/hunt_scene.ts <frame>

import fs from 'node:fs'; import path from 'node:path';
import { decompressLzss } from './lzss.ts';
import { loadIndex } from './lzss_index.ts';

const targetFrame = parseInt(process.argv[2] ?? '0', 10);
if (!targetFrame) { console.error('usage: hunt_scene.ts <frame>'); process.exit(1); }

// ---- state decode ----
const S = path.join(import.meta.dirname, '..', 'rendered', 'intro', 'state.bin');
const buf = fs.readFileSync(S);
const vs = buf.readUInt32LE(10), cs = buf.readUInt32LE(14), vss = buf.readUInt32LE(18), rs = buf.readUInt32LE(22);
let o = 26;
const vram = new Uint8Array(buf.subarray(o, o + vs)); o += vs;
const cram = new Uint8Array(buf.subarray(o, o + cs)); o += cs;
const vsram = new Uint8Array(buf.subarray(o, o + vss)); o += vss;
const reg = new Uint8Array(buf.subarray(o, o + rs)); o += rs;
const ad = (d: Uint8Array) => { const c = buf.readUInt16LE(o); o += 2; for (let i = 0; i < c; i++) { const of = buf.readUInt16LE(o); o += 2; const l = buf.readUInt16LE(o); o += 2; d.set(buf.subarray(o, o + l), of); o += l; } };
for (let f = 1; f <= targetFrame; f++) { ad(vram); ad(cram); ad(vsram); ad(reg); }

// ---- what we're hunting ----
const ntBase = (reg[2] & 0x38) << 10;
const used = new Set<number>();
for (let row = 0; row < 28; row++) for (let col = 0; col < 32; col++) {
  const off = ntBase + (row * 32 + col) * 2;
  const w = vram[off] | (vram[off + 1] << 8);
  const t = w & 0x7ff; if (t > 0) used.add(t);
}
if (used.size === 0) { console.log(`f${targetFrame}: plane A has no non-blank tiles — nothing to hunt`); process.exit(0); }
const sorted = [...used].sort((a, b) => a - b);
console.log(`f${targetFrame}: plane A uses ${used.size} tiles, range $${sorted[0].toString(16)}..$${sorted.at(-1)!.toString(16)}`);

// Pick highest-variance tile (skip mostly-zero tiles that would match anywhere).
let bestTile = sorted[0], bestScore = 0;
for (const t of used) {
  let nz = 0; for (let i = 0; i < 32; i++) if (vram[t * 32 + i] !== 0) nz++;
  if (nz > bestScore) { bestScore = nz; bestTile = t; }
}
// Also: swapped form to match disc byte order.
const raw = Buffer.from(vram.subarray(bestTile * 32, bestTile * 32 + 32));
const swp = Buffer.alloc(32);
for (let i = 0; i < 32; i += 2) { swp[i] = raw[i + 1]; swp[i + 1] = raw[i]; }
console.log(`  fingerprint tile $${bestTile.toString(16)} (${bestScore}/32 non-zero)`);

// ---- disc hunt ----
const files = fs.readdirSync('D:/blastem/snatcher/extracted').filter(f => /\.BIN$/i.test(f));

// Hunt tile block: LZSS with u16 BE size prefix in [$200, $10000] range.
let tileHit: { file: string; off: number; size: number; loadTileBase: number } | null = null;
outer: for (const f of files) {
  const d = fs.readFileSync(path.join('D:/blastem/snatcher/extracted', f));
  for (let off = 0; off + 4 < Math.min(d.length, 0x40000); off += 2) {
    const sz = (d[off] << 8) | d[off + 1];
    if (sz < 0x200 || sz > 0x10000) continue;
    try {
      const dec = Buffer.from(decompressLzss(d, off + 2, sz));
      if (dec.length < 64) continue;
      const idx = dec.indexOf(swp);
      if (idx >= 0 && idx % 32 === 0) {
        const loadTileBase = bestTile - (idx / 32);
        tileHit = { file: f, off, size: sz, loadTileBase };
        console.log(`  TILES: ${f} @$${off.toString(16)} LZSS(BE size=$${sz.toString(16)}, ${dec.length}B) → loads to VRAM tile $${loadTileBase.toString(16)}`);
        break outer;
      }
    } catch { }
  }
}
if (!tileHit) { console.log('  TILES: not found'); process.exit(1); }

// Verify coverage: every used tile in the decoded block?
const disc = fs.readFileSync(path.join('D:/blastem/snatcher/extracted', tileHit.file));
const decoded = Buffer.from(decompressLzss(disc, tileHit.off + 2, tileHit.size));
const decSwp = Buffer.alloc(decoded.length);
for (let i = 0; i + 1 < decoded.length; i += 2) { decSwp[i] = decoded[i + 1]; decSwp[i + 1] = decoded[i]; }
const blocks: { file: string; off: number; size: number; loadTileBase: number; tileCount: number }[] = [];
blocks.push({ ...tileHit, tileCount: decoded.length / 32 });
let covered = 0;
const uncovered: number[] = [];
for (const t of used) {
  const bo = (t - tileHit.loadTileBase) * 32;
  if (bo < 0 || bo + 32 > decSwp.length) { uncovered.push(t); continue; }
  if (decSwp.subarray(bo, bo + 32).equals(Buffer.from(vram.subarray(t * 32, t * 32 + 32)))) covered++;
  else uncovered.push(t);
}
console.log(`  TILE-BLOCK #1 COVERAGE: ${covered}/${used.size}`);

// If tiles remain uncovered, hunt for follow-on blocks. Take the lowest
// uncovered tile as the anchor for block #2, etc.
while (uncovered.length > 0 && blocks.length < 6) {
  uncovered.sort((a, b) => a - b);
  const anchor = uncovered[0];
  // Distinctive tile: pick highest-variance from uncovered.
  let ancTile = anchor, ancScore = 0;
  for (const t of uncovered) { let nz = 0; for (let i = 0; i < 32; i++) if (vram[t * 32 + i] !== 0) nz++; if (nz > ancScore) { ancScore = nz; ancTile = t; } }
  const ancRaw = Buffer.from(vram.subarray(ancTile * 32, ancTile * 32 + 32));
  const ancSwp = Buffer.alloc(32);
  for (let i = 0; i < 32; i += 2) { ancSwp[i] = ancRaw[i + 1]; ancSwp[i + 1] = ancRaw[i]; }
  // Fast path via the LZSS index: look up any block whose decoded head
  // contains the anchor tile's 32 swapped bytes. Turns an O(files × offsets ×
  // decompress) hunt into O(index-entries × string-match).
  const idx = loadIndex();
  const ancSwpHex = ancSwp.toString('hex');
  let hit: { file: string; off: number; size: number; loadTileBase: number; tileCount: number } | null = null;
  for (const e of idx) {
    if (blocks.some(b => b.file === e.file && e.off >= b.off && e.off < b.off + b.size + 2)) continue;
    const p = e.headHex.indexOf(ancSwpHex);
    if (p >= 0 && p % 64 === 0) {   // 64 hex chars = 32 bytes = 1 tile boundary
      // Verify by full decompress (index only records first 128 bytes so we
      // don't accidentally match a byte-aligned coincidence deeper in the block).
      try {
        const d = fs.readFileSync(path.join('D:/blastem/snatcher/extracted', e.file));
        const dec = Buffer.from(decompressLzss(d, e.off + 2, e.size));
        const swp = Buffer.alloc(dec.length);
        for (let i = 0; i + 1 < dec.length; i += 2) { swp[i] = dec[i + 1]; swp[i + 1] = dec[i]; }
        const idx = swp.indexOf(ancSwp);
        if (idx >= 0 && idx % 32 === 0) {
          hit = { file: e.file, off: e.off, size: e.size, loadTileBase: ancTile - (idx / 32), tileCount: dec.length / 32 };
          break;
        }
      } catch { }
    }
  }
  // The index covers every plausible LZSS block on disc; if the anchor tile
  // isn't at the start of any indexed block, it may be MID-block (block
  // contains many tiles and the anchor is at offset != 0). Fallback: full-
  // decode each indexed block and search the entire decoded body.
  if (!hit) {
    for (const e of idx) {
      if (blocks.some(b => b.file === e.file && e.off >= b.off && e.off < b.off + b.size + 2)) continue;
      try {
        const d = fs.readFileSync(path.join('D:/blastem/snatcher/extracted', e.file));
        const dec = Buffer.from(decompressLzss(d, e.off + 2, e.size));
        const swp = Buffer.alloc(dec.length);
        for (let i = 0; i + 1 < dec.length; i += 2) { swp[i] = dec[i + 1]; swp[i + 1] = dec[i]; }
        const pos = swp.indexOf(ancSwp);
        if (pos >= 0 && pos % 32 === 0) {
          hit = { file: e.file, off: e.off, size: e.size, loadTileBase: ancTile - (pos / 32), tileCount: dec.length / 32 };
          break;
        }
      } catch { }
    }
  }
  if (!hit) { console.log(`  TILE-BLOCK #${blocks.length + 1}: not found (${uncovered.length} tiles uncovered)`); break; }
  blocks.push(hit);
  // Verify block #N coverage
  const dN = fs.readFileSync(path.join('D:/blastem/snatcher/extracted', hit.file));
  const decN = Buffer.from(decompressLzss(dN, hit.off + 2, hit.size));
  const decNS = Buffer.alloc(decN.length);
  for (let i = 0; i + 1 < decN.length; i += 2) { decNS[i] = decN[i + 1]; decNS[i + 1] = decN[i]; }
  const still: number[] = [];
  let addedCovered = 0;
  for (const t of uncovered) {
    const bo = (t - hit.loadTileBase) * 32;
    if (bo < 0 || bo + 32 > decNS.length) { still.push(t); continue; }
    if (decNS.subarray(bo, bo + 32).equals(Buffer.from(vram.subarray(t * 32, t * 32 + 32)))) addedCovered++;
    else still.push(t);
  }
  covered += addedCovered;
  console.log(`  TILE-BLOCK #${blocks.length}: ${hit.file} @$${hit.off.toString(16)} LZSS(size=$${hit.size.toString(16)}, ${decN.length}B) → tile $${hit.loadTileBase.toString(16)}; +${addedCovered} covered (${covered}/${used.size} total)`);
  uncovered.length = 0; uncovered.push(...still);
  if (addedCovered === 0) break;
}
console.log(`  TOTAL TILE COVERAGE: ${covered}/${used.size}${covered === used.size ? ' ✓' : ''}`);
// Update tileHit to be a summary for the print at the end
;(tileHit as any).blocks = blocks;

// Hunt palette: line 0 raw BE bytes.
const palLine0 = Buffer.alloc(32);
for (let i = 0; i < 16; i++) {
  const p = cram[i * 2] | (cram[i * 2 + 1] << 8);
  const r = p & 7, g = (p >> 3) & 7, b = (p >> 6) & 7;
  const w = (b << 9) | (g << 5) | (r << 1);
  palLine0[i * 2] = w >> 8; palLine0[i * 2 + 1] = w & 0xff;
}
let palHit: { file: string; off: number; lines: number } | null = null;
for (const f of files) {
  const d = fs.readFileSync(path.join('D:/blastem/snatcher/extracted', f));
  const i = d.indexOf(palLine0);
  if (i >= 0) {
    // Detect how many contiguous palette lines follow — check up to 4.
    let lines = 1;
    for (let ln = 1; ln < 4; ln++) {
      const expected = Buffer.alloc(32);
      for (let e = 0; e < 16; e++) {
        const p = cram[(ln * 16 + e) * 2] | (cram[(ln * 16 + e) * 2 + 1] << 8);
        const r = p & 7, g = (p >> 3) & 7, b = (p >> 6) & 7;
        const w = (b << 9) | (g << 5) | (r << 1);
        expected[e * 2] = w >> 8; expected[e * 2 + 1] = w & 0xff;
      }
      if (d.subarray(i + ln * 32, i + (ln + 1) * 32).equals(expected)) lines++;
      else break;
    }
    palHit = { file: f, off: i, lines };
    console.log(`  PALETTE: ${f} @$${i.toString(16)} (${lines} line(s))`);
    break;
  }
}

// Hunt nametable — try RAW and LZSS. Use a distinctive 64-byte middle chunk.
const ntFull = Buffer.alloc(1792);
for (let row = 0; row < 28; row++) for (let col = 0; col < 32; col++) {
  const vo = ntBase + (row * 32 + col) * 2;
  ntFull[(row * 32 + col) * 2]     = vram[vo];
  ntFull[(row * 32 + col) * 2 + 1] = vram[vo + 1];
}
const ntBE = Buffer.alloc(1792);
for (let i = 0; i + 1 < 1792; i += 2) { ntBE[i] = ntFull[i + 1]; ntBE[i + 1] = ntFull[i]; }
const chunk = ntBE.subarray(200, 264);
let ntHit: { file: string; off: number; kind: 'raw' | 'lzss'; size?: number } | null = null;
outer2: for (const f of files) {
  const d = fs.readFileSync(path.join('D:/blastem/snatcher/extracted', f));
  const iR = d.indexOf(chunk);
  if (iR >= 0) { ntHit = { file: f, off: iR - 200, kind: 'raw' }; break; }
  for (let off = 0; off + 4 < Math.min(d.length, 0x40000); off += 2) {
    const sz = (d[off] << 8) | d[off + 1];
    if (sz < 0x100 || sz > 0x8000) continue;
    try {
      const dec = Buffer.from(decompressLzss(d, off + 2, sz));
      if (dec.length < 64) continue;
      if (dec.indexOf(chunk) >= 0) { ntHit = { file: f, off, kind: 'lzss', size: sz }; break outer2; }
    } catch { }
  }
}
if (ntHit) console.log(`  NAMETABLE: ${ntHit.file} @$${ntHit.off.toString(16)} ${ntHit.kind}${ntHit.size ? ` (size=$${ntHit.size.toString(16)})` : ''}`);
else console.log('  NAMETABLE: not found');

// ---- scenes.ts entry ----
if (tileHit && palHit && ntHit) {
  console.log(`\n// Paste into port/build/scenes.ts SCENES array:`);
  console.log(`  {`);
  console.log(`    id: '<SCENE_ID>',`);
  const bs = (tileHit as any).blocks as { file: string; off: number; loadTileBase: number }[];
  if (bs.length === 1) {
    console.log(`    tiles: [{ file: '${tileHit.file}', offset: 0x${tileHit.off.toString(16)}, compression: 'lzss', sizePrefix: true }],`);
  } else {
    console.log(`    tiles: [`);
    for (let i = 0; i < bs.length; i++) {
      const name = String.fromCharCode(0x41 + i);
      console.log(`      { name: '${name}', file: '${bs[i].file}', offset: 0x${bs[i].off.toString(16)}, compression: 'lzss', sizePrefix: true },  // loadTileBase 0x${bs[i].loadTileBase.toString(16)}`);
    }
    console.log(`    ],`);
  }
  console.log(`    palette: { file: '${palHit.file}', offset: 0x${palHit.off.toString(16)}, lines: ${palHit.lines} },`);
  if (ntHit.kind === 'lzss')
    console.log(`    nametable: { file: '${ntHit.file}', offset: 0x${ntHit.off.toString(16)}, compression: 'lzss', sizePrefix: true, loadTileBase: 0x${tileHit.loadTileBase.toString(16)} },`);
  else
    console.log(`    nametable: { file: '${ntHit.file}', offset: 0x${ntHit.off.toString(16)}, compression: 'raw', loadTileBase: 0x${tileHit.loadTileBase.toString(16)} },`);
  console.log(`  },`);
}
