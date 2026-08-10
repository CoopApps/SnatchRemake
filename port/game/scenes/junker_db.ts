// Scene: JUNKER cybernetic database screen (bio-cells + character menu)
// (capture f6560). First scene ported cleanly after the snapshot demolition; every byte traces to disc.
//
// TRUE PORT — every byte in the assets was decoded from disc:
//   tiles     ← DATA_D1.BIN $143e   (LZSS, u16 BE size prefix, 158 tiles)
//   palette   ← DATA_D1.BIN $1d822  (BE, 4 lines)
//   nametable ← DATA_D1.BIN $1ff62  (LZSS, u16 BE size prefix)
// All three offsets recorded in port/build/scenes.ts, decoded at build time
// into port/game/assets/junker_db/. Verified 158/158 tiles byte-exact
// against reference by port/build/pin_subway.ts (capture used ONLY as oracle
// during the disc hunt; the port ships disc bytes, not capture bytes).

import { Screen, type RgbFrame, type Palette } from '../render/screen.ts';
import { loadScene, wordToRgb } from '../assets/loader.ts';

interface Cell { c: number; r: number; tile: number; pal: number; hf: number; vf: number; pri?: number; }
interface Layout {
  originCol: number; originRow: number;
  planeA: Cell[]; planeB: Cell[]; sprites: unknown[];
  tileToDisc: Record<string, number>;
}

export const junkerDb = {
  id: 'junker_db',
  width: 256,
  height: 224,
  checkpoints: [6560],
  render(_frame: number): RgbFrame {
    const assets = loadScene('junker_db');
    const layout = assets.layout as Layout;
    const pals: Palette[] = assets.paletteWords.map(line => line.map(w => wordToRgb(w)));

    const screen = new Screen(256, 224);
    screen.clear(pals[0][0]);
    for (const cell of layout.planeA) {
      const li = layout.tileToDisc[String(cell.tile)];
      if (li === undefined) continue;
      const tile = assets.tiles[li];
      if (!tile) continue;
      screen.drawTile(tile, (layout.originCol + cell.c) * 8, (layout.originRow + cell.r) * 8,
        pals[cell.pal] ?? pals[0], { flipH: !!cell.hf, flipV: !!cell.vf });
    }
    return screen.frame();
  },
};
