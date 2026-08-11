// Decode a Genesis palette block from disc bytes into RGB.
//
// On disc, a palette line is 16 colours × 2 bytes, each a 9-bit big-endian
// word `0000 BBB0 GGG0 RRR0`. Colour 0 of each line is transparent for sprites.
// (This is the SOURCE format — NOT GPGX's packed CRAM; see RESEARCH_LOG cont.40.)
//
// The 3-bit level → 8-bit output ladder matches the hardware DAC / GPGX's
// non-shadow rendering path.

export interface Rgb { r: number; g: number; b: number; }

const DAC = [0, 33, 66, 99, 140, 173, 206, 239];

/** Decode one 16-colour line at `off` in `disc`. */
export function decodePaletteLine(disc: Uint8Array, off: number): Rgb[] {
  const line: Rgb[] = [];
  for (let e = 0; e < 16; e++) {
    const w = (disc[off + e * 2] << 8) | disc[off + e * 2 + 1];
    line.push({ r: DAC[(w >> 1) & 7], g: DAC[(w >> 5) & 7], b: DAC[(w >> 9) & 7] });
  }
  return line;
}

/** Decode a set of palette lines (offsets need not be contiguous on disc). */
export function decodePalette(disc: Uint8Array, lineOffsets: number[]): Rgb[][] {
  return lineOffsets.map(off => decodePaletteLine(disc, off));
}

/** Raw 9-bit words for a line — kept for byte-exact round-trip verification. */
export function paletteWords(disc: Uint8Array, off: number): number[] {
  const w: number[] = [];
  for (let e = 0; e < 16; e++) w.push((disc[off + e * 2] << 8) | disc[off + e * 2 + 1]);
  return w;
}
