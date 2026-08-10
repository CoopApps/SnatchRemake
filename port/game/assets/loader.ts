// Runtime asset loader — reads ONLY from port/game/assets/<scene>/. No disc.
// Works in Node (fs) and browser (fetch) via an async preload step; render
// code stays synchronous.

import type { Tile, Palette, Rgb } from '../render/screen.ts';

interface Manifest {
  id: string;
  blocks: { name: string; file: string; tiles: number }[];
  paletteLines: number;
  hasEngineTables: boolean;
}

// Cache is attached to globalThis so that if the module ever loads twice
// (Windows path-case quirks in tsx/Node ESM, mixed relative/absolute imports),
// all instances still share the same populated store. Concrete symptom this
// avoids: preload succeeds in one module, load fails in the other.
type CacheEntry = {
  manifest: Manifest;
  tileBlocks: Record<string, Tile[]>;
  palette: Palette[];
  paletteWords: number[][];
  engineTables?: Record<string, number[]>;
  layout?: unknown;
  extras: Record<string, unknown>;
};
const GLOBAL_KEY = '__snatcherPortAssetCache__';
type Cache = Map<string, CacheEntry>;
const cache: Cache =
  ((globalThis as any)[GLOBAL_KEY] as Cache | undefined) ??
  ((globalThis as any)[GLOBAL_KEY] = new Map<string, CacheEntry>());

/** TEST HELPER — clear the loader's asset cache. Only used by the disc-hidden
 *  proof in port/harness/run.ts to verify that a fresh preload from bundled
 *  files succeeds without the original disc present. NOT for game code. */
export function _resetAssetCache(): void { cache.clear(); }

/** Split raw 4bpp tile bytes (32B/tile, high nibble = left pixel) into tiles. */
function tilesFromBytes(bytes: Uint8Array): Tile[] {
  const out: Tile[] = [];
  for (let t = 0; t + 32 <= bytes.length; t += 32) {
    const tile = new Uint8Array(64);
    for (let row = 0; row < 8; row++)
      for (let col = 0; col < 8; col++) {
        const byte = bytes[t + row * 4 + (col >> 1)];
        tile[row * 8 + col] = (col & 1) ? (byte & 0x0f) : (byte >> 4);
      }
    out.push(tile);
  }
  return out;
}

export interface SceneAssets {
  manifest: Manifest;
  tileBlocks: Record<string, Tile[]>;
  tiles: Tile[];              // first (or only) block, for convenience
  palette: Palette[];
  paletteWords: number[][];
  engineTables?: Record<string, number[]>;
  layout?: unknown;
  extras: Record<string, unknown>;
}

export const DAC: readonly number[] = [0, 33, 66, 99, 140, 173, 206, 239];

export function wordToRgb(w: number): Rgb {
  return { r: DAC[(w & 0x00e) >> 1], g: DAC[(w & 0x0e0) >> 5], b: DAC[(w & 0xe00) >> 9] };
}

const inBrowser = typeof globalThis !== 'undefined' && typeof (globalThis as any).window !== 'undefined';

async function readText(rel: string, baseUrl?: string): Promise<string> {
  if (inBrowser) {
    const r = await fetch(`${baseUrl}/${rel}`);
    if (!r.ok) throw new Error(`fetch ${rel}: ${r.status}`);
    return r.text();
  }
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  return readFile(resolve(here, rel), 'utf8');
}
async function readBytes(rel: string, baseUrl?: string): Promise<Uint8Array> {
  if (inBrowser) {
    const r = await fetch(`${baseUrl}/${rel}`);
    if (!r.ok) throw new Error(`fetch ${rel}: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  return new Uint8Array(await readFile(resolve(here, rel)));
}

function buildEntry(manifest: Manifest, palette: Palette[], paletteWords: number[][],
                    tileBlocks: Record<string, Tile[]>, engineTables?: Record<string, number[]>, layout?: unknown, extras: Record<string, unknown> = {}) {
  return { manifest, palette, paletteWords, tileBlocks, engineTables, layout, extras };
}

/** Async preload — call once at boot (browser and harness both). baseUrl is
 *  the browser-facing prefix; ignored in Node (uses local file paths). */
export async function preloadScene(id: string, baseUrl = './game/assets'): Promise<void> {
  if (cache.has(id)) return;
  const dir = id;
  // Scenes with no assets on disk (e.g. the title_reveal placeholder that
  // only draws the port-authored PRESS ANY KEY prompt) are legitimate — no
  // manifest to load, just skip. The scene's render() must not call
  // loadScene() in that case.
  let manifestText: string;
  try { manifestText = await readText(`${dir}/manifest.json`, baseUrl); }
  catch { return; }
  const manifest = JSON.parse(manifestText) as Manifest;
  const tileBlocks: Record<string, Tile[]> = {};
  for (const b of manifest.blocks) tileBlocks[b.name] = tilesFromBytes(await readBytes(`${dir}/${b.file}`, baseUrl));
  const paletteRaw = JSON.parse(await readText(`${dir}/palette.json`, baseUrl)) as Rgb[][];
  const palette: Palette[] = paletteRaw.map(line => line.map(c => ({ r: c.r, g: c.g, b: c.b })));
  const paletteWords = JSON.parse(await readText(`${dir}/palette_words.json`, baseUrl)) as number[][];
  let engineTables: Record<string, number[]> | undefined;
  if (manifest.hasEngineTables) engineTables = JSON.parse(await readText(`${dir}/engine_tables.json`, baseUrl));
  let layout: unknown;
  try { layout = JSON.parse(await readText(`${dir}/layout.json`, baseUrl)); } catch { /* optional */ }
  const extras: Record<string, unknown> = {};
  cache.set(id, buildEntry(manifest, palette, paletteWords, tileBlocks, engineTables, layout, extras));
}

/** Sync loader — read from cache filled by preloadScene(). */
export function loadScene(id: string): SceneAssets {
  const entry = cache.get(id);
  if (!entry) throw new Error(`preloadScene('${id}') was not called before loadScene('${id}'). Runtime must preload all scenes at boot.`);
  const firstBlock = entry.manifest.blocks[0]?.name;
  return { ...entry, tiles: firstBlock ? entry.tileBlocks[firstBlock] : [] };
}
