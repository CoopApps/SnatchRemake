// BUILD-TIME asset exporter. Reads the disc (extracted/*.BIN) and writes
// ready-to-render assets to port/game/assets/<scene>/. Run once per source
// change; the port itself never uses the disc.
//
//   npx tsx port/build/export_assets.ts
//
// Output per scene:
//   tiles_<block>.bin       — raw 4bpp decoded tile bytes (32B per tile)
//   palette.json            — RGB colours per line (bundled in the port's DAC form)
//   engine_tables.json      — palette animation words (Konami only)
//   manifest.json           — small metadata (blocks, tile counts, sizes)
// The layout .json files are extracted by their own dev tools and live in
// port/game/assets/<scene>/layout.json (moved here from scenes/data/).

import fs from 'node:fs';
import path from 'node:path';
import { discFile } from './disc.ts';
import { decompressLzss } from './lzss.ts';
import { SCENES, type SceneSpec, type TileBlockSpec } from './scenes.ts';

const OUT_ROOT = path.resolve(import.meta.dirname, '..', 'game', 'assets');

const DAC = [0, 33, 66, 99, 140, 173, 206, 239]; // Genesis DAC ladder

function decodeTileBlock(spec: TileBlockSpec): Buffer {
  const disc = discFile(spec.file);
  if (spec.compression !== 'lzss') throw new Error(`unknown compression: ${spec.compression}`);
  const startOff = spec.offset + (spec.sizePrefix ? 2 : 0);
  const decoded = decompressLzss(disc, startOff, 0x20000);
  const body = spec.headerSkip ? decoded.subarray(spec.headerSkip) : decoded;
  return Buffer.from(body);
}

function decodePaletteWords(file: string, off: number, lines: number, lineOffsets?: number[]): number[][] {
  const disc = discFile(file);
  const out: number[][] = [];
  for (let line = 0; line < lines; line++) {
    const lo = lineOffsets ? lineOffsets[line] : off + line * 32;
    const row: number[] = [];
    for (let i = 0; i < 16; i++) row.push((disc[lo + i * 2] << 8) | disc[lo + i * 2 + 1]);
    out.push(row);
  }
  return out;
}
function paletteWordsToRgb(words: number[][]): { r: number; g: number; b: number }[][] {
  return words.map(line => line.map(w => ({
    r: DAC[(w & 0x00e) >> 1], g: DAC[(w & 0x0e0) >> 5], b: DAC[(w & 0xe00) >> 9],
  })));
}

function exportScene(spec: SceneSpec): void {
  const dir = path.join(OUT_ROOT, spec.id);
  fs.mkdirSync(dir, { recursive: true });

  const blocks: { name?: string; file: string; tiles: number }[] = [];
  // Track each plane-A block's VRAM load base + where it starts in the
  // concatenated main file, so multi-block scenes can build one tileToDisc.
  const aBlockRanges: { base: number; count: number; localStart: number }[] = [];
  if (spec.nametable) {
    // Nametable-driven scenes: concatenate ALL plane-A blocks into one
    // tiles_main.bin. Per-block load base = block.loadTileBase, defaulting
    // to nametable.loadTileBase for the first block.
    const parts: Buffer[] = [];
    let localStart = 0;
    for (let i = 0; i < spec.tiles.length; i++) {
      const bytes = decodeTileBlock(spec.tiles[i]);
      const base = spec.tiles[i].loadTileBase ?? (i === 0 ? spec.nametable.loadTileBase : undefined);
      if (base === undefined) throw new Error(`${spec.id}: block ${i} needs loadTileBase`);
      aBlockRanges.push({ base, count: bytes.length / 32, localStart });
      localStart += bytes.length / 32;
      parts.push(bytes);
    }
    const all = Buffer.concat(parts);
    fs.writeFileSync(path.join(dir, 'tiles_main.bin'), all);
    blocks.push({ name: 'main', file: 'tiles_main.bin', tiles: all.length / 32 });
  } else {
    for (const t of spec.tiles) {
      const bytes = decodeTileBlock(t);
      const name = t.name ?? 'main';
      fs.writeFileSync(path.join(dir, `tiles_${name}.bin`), bytes);
      blocks.push({ name, file: `tiles_${name}.bin`, tiles: bytes.length / 32 });
    }
  }

  const paletteWords = decodePaletteWords(spec.palette.file, spec.palette.offset, spec.palette.lines, spec.palette.lineOffsets);
  const palette = paletteWordsToRgb(paletteWords);
  // palette.json — RGB for the renderer. palette_words.json — raw Genesis 0BGR
  // words for engines that mutate the palette (fades etc.). Both derived, kept
  // side-by-side so the port doesn't need to know Genesis encoding at runtime.
  fs.writeFileSync(path.join(dir, 'palette.json'), JSON.stringify(palette));
  fs.writeFileSync(path.join(dir, 'palette_words.json'), JSON.stringify(paletteWords));

  // Optional plane B: bundle its tiles as an additional block, and its
  // nametable cells alongside plane A's in the same layout.json.
  let planeBCells: { c: number; r: number; tile: number; pal: number; hf: number; vf: number; pri: number }[] = [];
  let planeBTileToLocal: Record<string, number> = {};
  if (spec.planeB) {
    // Concatenate plane-B blocks (same multi-block scheme as plane A).
    const bRanges: { base: number; count: number; localStart: number }[] = [];
    {
      const parts: Buffer[] = [];
      let localStart = 0;
      for (let i = 0; i < spec.planeB.tiles.length; i++) {
        const bytes = decodeTileBlock(spec.planeB.tiles[i]);
        const base = spec.planeB.tiles[i].loadTileBase ?? (i === 0 ? spec.planeB.nametable.loadTileBase : undefined);
        if (base === undefined) throw new Error(`${spec.id}: planeB block ${i} needs loadTileBase`);
        bRanges.push({ base, count: bytes.length / 32, localStart });
        localStart += bytes.length / 32;
        parts.push(bytes);
      }
      const all = Buffer.concat(parts);
      fs.writeFileSync(path.join(dir, 'tiles_B.bin'), all);
      blocks.push({ name: 'B', file: 'tiles_B.bin', tiles: all.length / 32 });
      (spec.planeB as any)._ranges = bRanges;   // used below for tileToDiscB
    }
    const disc = discFile(spec.planeB.nametable.file);
    const startOff = spec.planeB.nametable.offset + (spec.planeB.nametable.sizePrefix ? 2 : 0);
    const bytes = spec.planeB.nametable.compression === 'lzss'
      ? decompressLzss(disc, startOff, 0x8000)
      : disc.subarray(startOff);
    const cols = spec.planeB.nametable.planeCols ?? 32;
    const rows = spec.planeB.nametable.planeRows ?? 28;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const off = (row * cols + col) * 2;
      const w = (bytes[off] << 8) | bytes[off + 1];
      const tile = w & 0x7ff;
      if (tile === 0) continue;
      planeBCells.push({ c: col, r: row, tile, pal: (w >> 13) & 3, hf: (w >> 11) & 1, vf: (w >> 12) & 1, pri: (w >> 15) & 1 });
    }
    const bTileRanges = (spec.planeB as any)._ranges as { base: number; count: number; localStart: number }[];
    const seenB = new Set<number>();
    for (const c of planeBCells) {
      if (seenB.has(c.tile)) continue;
      seenB.add(c.tile);
      for (let i = bTileRanges.length - 1; i >= 0; i--) {
        const b = bTileRanges[i];
        if (c.tile >= b.base && c.tile < b.base + b.count) {
          planeBTileToLocal[String(c.tile)] = b.localStart + (c.tile - b.base);
          break;
        }
      }
    }
  }

  if (spec.nametable) {
    // Decode the nametable block from disc and turn it into a layout.json
    // (same shape as the ones migrated from scenes/data/) — the port renders
    // from this without knowing the ROM's byte order.
    const disc = discFile(spec.nametable.file);
    const startOff = spec.nametable.offset + (spec.nametable.sizePrefix ? 2 : 0);
    let bytes: Uint8Array;
    if (spec.nametable.compression === 'lzss') {
      bytes = decompressLzss(disc, startOff, 0x8000);
    } else {
      bytes = disc.subarray(startOff);
    }
    const cols = spec.nametable.planeCols ?? 32;
    const rows = spec.nametable.planeRows ?? 28;
    // Bytes are BE 68000 word stream: (tile-high, tile-low+attr-low, ...).
    const cells: { c: number; r: number; tile: number; pal: number; hf: number; vf: number; pri: number }[] = [];
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const off = (row * cols + col) * 2;
      const w = (bytes[off] << 8) | bytes[off + 1];   // BE from disc
      const tile = w & 0x7ff, pal = (w >> 13) & 3, hf = (w >> 11) & 1, vf = (w >> 12) & 1, pri = (w >> 15) & 1;
      if (tile === 0) continue;
      cells.push({ c: col, r: row, tile, pal, hf, vf, pri });
    }
    // tileToDisc maps ROM tile-index → local index in the CONCATENATED main
    // block. Later blocks win on overlap (they load over earlier ones, same
    // as consecutive DMAs into VRAM would).
    const tileToDisc: Record<string, number> = {};
    const seen = new Set<number>();
    for (const c of cells) {
      if (seen.has(c.tile)) continue;
      seen.add(c.tile);
      for (let i = aBlockRanges.length - 1; i >= 0; i--) {
        const b = aBlockRanges[i];
        if (c.tile >= b.base && c.tile < b.base + b.count) {
          tileToDisc[String(c.tile)] = b.localStart + (c.tile - b.base);
          break;
        }
      }
    }
    // Merge planeB's tileToDisc with A's (planeB tiles are stored in a
    // separate 'B' block; the port loader resolves by looking up localIdx
    // against the appropriate block using a per-cell block key).
    fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify({
      originCol: 0, originRow: 0,
      planeA: cells,
      planeB: planeBCells,
      sprites: [],
      tileToDisc,           // for plane A tiles (block name 'main')
      tileToDiscB: planeBTileToLocal, // for plane B tiles (block name 'B')
    }));
  }

  if (spec.engineTables) {
    const tables: Record<string, number[]> = {};
    for (const et of spec.engineTables) {
      const disc = discFile(et.file);
      tables[et.key] = Array.from({ length: et.wordCount }, (_, i) =>
        et.key === 'bar_cycle'
          ? disc[et.offset + i]                             // byte cycle for bar shimmer
          : (disc[et.offset + i * 2] << 8) | disc[et.offset + i * 2 + 1]);
    }
    fs.writeFileSync(path.join(dir, 'engine_tables.json'), JSON.stringify(tables));
  }

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    id: spec.id,
    blocks,
    paletteLines: spec.palette.lines,
    hasEngineTables: !!spec.engineTables,
  }, null, 2));

  console.log(`  ${spec.id}: ${blocks.length} tile block(s), ${blocks.reduce((s, b) => s + b.tiles, 0)} tiles, ${palette.length} palette line(s)${spec.engineTables ? `, ${spec.engineTables.length} engine table(s)` : ''}`);
}

// Move any existing layout JSONs from scenes/data/ next to the new assets dir.
function migrateLayouts(): void {
  const srcDir = path.resolve(import.meta.dirname, '..', 'game', 'scenes', 'data');
  if (!fs.existsSync(srcDir)) return;
  for (const f of fs.readdirSync(srcDir)) {
    const m = f.match(/^(\w+)\.layout\.json$/);
    if (!m) continue;
    const dst = path.join(OUT_ROOT, m[1], 'layout.json');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(srcDir, f), dst);
    console.log(`  migrated layout: ${m[1]}`);
  }
}

console.log('port asset export');
console.log('=================');
fs.mkdirSync(OUT_ROOT, { recursive: true });
for (const s of SCENES) exportScene(s);
console.log('\nlayout migration');
migrateLayouts();
console.log(`\nassets written to ${OUT_ROOT}`);
