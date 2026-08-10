// Reusable palette-animation primitives — ported from MAINCPU_IP routines the
// game uses in more than one scene. Each function is named for what it does
// plus the original routine address, so we recognise it when it recurs.
//
// A "palette shadow" is a Uint16Array of Genesis 0BGR words (16 per palette
// line × 4 lines = 64). Scenes maintain their own shadow; these primitives
// mutate it in place, exactly matching the m68k routines' effects.

/**
 * Per-channel fade — step every colour word one DAC level down per channel,
 * with the channel floored at 0.
 *
 * Ported from MAINCPU_IP $202A20 (Konami-sequence fade-out). The m68k body:
 *   for each of 64 colour words:
 *     if (w & 0xE00) w -= 0x200   // blue channel step
 *     if (w & 0x0E0) w -= 0x020   // green channel step
 *     if (w & 0x00E) w -= 0x002   // red channel step
 *
 * The game triggers this every OTHER vblank (counter parity gate); that gate
 * lives in the SCENE (each scene decides its fade cadence). This function
 * performs one step unconditionally.
 */
export function stepFadeToBlack_202a20(shadow: Uint16Array): void {
  for (let i = 0; i < shadow.length; i++) {
    const w = shadow[i];
    let b = w & 0xe00, g = w & 0x0e0, r = w & 0x00e;
    if (b !== 0) b -= 0x200;
    if (g !== 0) g -= 0x020;
    if (r !== 0) r -= 0x002;
    shadow[i] = b | g | r;
  }
}

/** True when the shadow is fully faded to black (every entry is 0). */
export function isBlack(shadow: Uint16Array): boolean {
  for (let i = 0; i < shadow.length; i++) if (shadow[i] !== 0) return false;
  return true;
}

/** Load one 16-word line into the shadow. */
export function loadPaletteLine(shadow: Uint16Array, line: number, words: number[]): void {
  for (let i = 0; i < 16; i++) shadow[line * 16 + i] = words[i];
}

/** Load N contiguous 16-word lines. */
export function loadPaletteBlock(shadow: Uint16Array, firstLine: number, wordsPerLine: number[][]): void {
  for (let n = 0; n < wordsPerLine.length; n++) loadPaletteLine(shadow, firstLine + n, wordsPerLine[n]);
}
