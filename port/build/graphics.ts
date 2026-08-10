// Decode disc graphics into the port's own formats: 8x8 tiles (64 palette
// indices each) and RGB palettes. Nothing here knows about Genesis VRAM layout;
// it just turns compressed disc bytes into tiles + colours the renderer can use.

import { decompressLzss } from './lzss.ts';
import type { Tile, Palette } from '../render/screen.ts';

/** Split raw 4bpp tile bytes (32 bytes/tile, row-major, high nibble = left px)
 *  into an array of 8x8 index tiles. */
export function tilesFromBytes(bytes: Uint8Array): Tile[] {
  const tiles: Tile[] = [];
  for (let t = 0; t + 32 <= bytes.length; t += 32) {
    const tile = new Uint8Array(64);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const byte = bytes[t + row * 4 + (col >> 1)];
        tile[row * 8 + col] = (col & 1) ? (byte & 0x0f) : (byte >> 4);
      }
    }
    tiles.push(tile);
  }
  return tiles;
}

/** Decompress an LZSS tile block from a disc file and decode it to tiles. */
export function decodeTiles(disc: Uint8Array, offset: number, maxBytes = 0x10000): Tile[] {
  return tilesFromBytes(decompressLzss(disc, offset, maxBytes));
}

/** Read a 16-colour palette from disc. Genesis stores 0x0BGR nibbles
 *  (each channel 0..7 in bits, low bit unused); we expand to 0..255 RGB. */
export function decodePalette(disc: Uint8Array, offset: number): Palette {
  const pal: Palette = [];
  for (let i = 0; i < 16; i++) {
    const w = (disc[offset + i * 2] << 8) | disc[offset + i * 2 + 1];
    const r = (w & 0x00e) >> 1, g = (w & 0x0e0) >> 5, b = (w & 0xe00) >> 9;
    pal.push({ r: r * 36, g: g * 36, b: b * 36 });
  }
  return pal;
}
