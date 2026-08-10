// Scene: fiction disclaimer. TRUE PORT — loads only bundled assets.

import { Screen, type RgbFrame, type Palette } from '../render/screen.ts';
import { loadScene, wordToRgb } from '../assets/loader.ts';
import { DisclaimerSequence } from '../engine/disclaimer_seq.ts';

interface Cell { c: number; r: number; font: number; pal: number; hf: number; vf: number; }
interface Layout { originCol: number; originRow: number; cells: Cell[]; }

let cached: { upTo: number; seq: DisclaimerSequence } | null = null;
function seqAt(seqFrame: number, paletteWords: number[][]): DisclaimerSequence {
  if (!cached || cached.upTo > seqFrame || cached.seq.done) {
    cached = { upTo: 0, seq: new DisclaimerSequence(paletteWords) };
  }
  while (cached.upTo < seqFrame && !cached.seq.done) { cached.seq.tick(); cached.upTo++; }
  return cached.seq;
}

/** Convert the engine's live palette shadow to RGB per line for the renderer. */
function shadowToPalettes(shadow: Uint16Array, lines: number): Palette[] {
  const out: Palette[] = [];
  for (let line = 0; line < lines; line++) {
    const row: Palette = [];
    for (let i = 0; i < 16; i++) row.push(wordToRgb(shadow[line * 16 + i]));
    out.push(row);
  }
  return out;
}

const SEQ_START = 3159;

export const disclaimer = {
  id: 'disclaimer',
  width: 256,
  height: 224,
  checkpoints: [3400, 3700, 3720],
  render(frame: number): RgbFrame {
    const assets = loadScene('disclaimer');
    const layout = assets.layout as Layout;
    const seq = seqAt(Math.max(0, frame - SEQ_START), assets.paletteWords);
    const pals = shadowToPalettes(seq.shadow, 4);

    const screen = new Screen(256, 224);
    // Background = tile 0 of the font block (verified: solid palette-index-5 fill).
    screen.clear(pals[0][assets.tiles[0][0]]);
    for (const cell of layout.cells) {
      const tile = assets.tiles[cell.font];
      if (!tile) continue;
      const x = (layout.originCol + cell.c) * 8;
      const y = (layout.originRow + cell.r) * 8;
      screen.drawTile(tile, x, y, pals[cell.pal] ?? pals[0], { flipH: !!cell.hf, flipV: !!cell.vf });
    }
    return screen.frame();
  },
};
