// Scene: Roland Sound Space credit. TRUE PORT — bundled assets only.

import { Screen, type RgbFrame, type Palette } from '../render/screen.ts';
import { loadScene, wordToRgb } from '../assets/loader.ts';
import { RssSequence } from '../engine/rss_seq.ts';

interface Cell { c: number; r: number; tile: number; pal: number; hf: number; vf: number; }
interface Layout { originCol: number; originRow: number; cells: Cell[]; }

let cached: { upTo: number; seq: RssSequence } | null = null;
function seqAt(f: number, pw: number[][]): RssSequence {
  if (!cached || cached.upTo > f || cached.seq.done) cached = { upTo: 0, seq: new RssSequence(pw) };
  while (cached.upTo < f && !cached.seq.done) { cached.seq.tick(); cached.upTo++; }
  return cached.seq;
}

function shadowToPalettes(shadow: Uint16Array, lines: number): Palette[] {
  const out: Palette[] = [];
  for (let line = 0; line < lines; line++) {
    const row: Palette = [];
    for (let i = 0; i < 16; i++) row.push(wordToRgb(shadow[line * 16 + i]));
    out.push(row);
  }
  return out;
}

const SEQ_START = 3820;

export const rss = {
  id: 'rss',
  width: 256,
  height: 224,
  checkpoints: [4000],
  render(frame: number): RgbFrame {
    const assets = loadScene('rss');
    const layout = assets.layout as Layout;
    const seq = seqAt(Math.max(0, frame - SEQ_START), assets.paletteWords);
    const pals = shadowToPalettes(seq.shadow, 4);

    const screen = new Screen(256, 224);
    screen.clear(pals[0][0]);
    for (const cell of layout.cells) {
      const tile = assets.tiles[cell.tile]; if (!tile) continue;
      const x = (layout.originCol + cell.c) * 8;
      const y = (layout.originRow + cell.r) * 8;
      screen.drawTile(tile, x, y, pals[cell.pal] ?? pals[0], { flipH: !!cell.hf, flipV: !!cell.vf });
    }
    return screen.frame();
  },
};
