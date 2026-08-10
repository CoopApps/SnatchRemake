// Factory for a scene that renders only plane A from bundled disc-sourced
// assets. Not a snapshot loader — the caller registers the scene in
// port/build/scenes.ts with real disc offsets, and this just plumbs the
// generic render (screen.clear + drawTile loop) for scenes whose full
// rendering IS just "put plane-A tiles at their nametable positions".
//
// Any scene that also needs plane B, sprites, palette fades, or dynamic
// tile composition must get its own scene file, not go through this.

import { Screen, type RgbFrame, type Palette } from '../render/screen.ts';
import { loadScene, wordToRgb } from '../assets/loader.ts';

interface Cell { c: number; r: number; tile: number; pal: number; hf: number; vf: number; pri?: number; }
interface Layout {
  originCol: number; originRow: number;
  planeA: Cell[]; planeB: Cell[]; sprites: unknown[];
  tileToDisc: Record<string, number>;    // for plane A tiles (main block)
  tileToDiscB?: Record<string, number>;  // for plane B tiles (B block)
}

export function makePlaneAScene(id: string, checkpoints: number[]) {
  return {
    id, width: 256, height: 224, checkpoints,
    render(_frame: number): RgbFrame {
      const assets = loadScene(id);
      const layout = assets.layout as Layout;
      const pals: Palette[] = assets.paletteWords.map(line => line.map(w => wordToRgb(w)));
      const screen = new Screen(256, 224);
      screen.clear(pals[0][0]);
      // Plane B behind plane A (VDP z-order without priority flags).
      const bTiles = assets.tileBlocks?.['B'];
      if (layout.planeB && layout.tileToDiscB && bTiles) {
        for (const cell of layout.planeB) {
          const li = layout.tileToDiscB[String(cell.tile)];
          if (li === undefined) continue;
          const tile = bTiles[li];
          if (!tile) continue;
          screen.drawTile(tile, (layout.originCol + cell.c) * 8, (layout.originRow + cell.r) * 8,
            pals[cell.pal] ?? pals[0], { flipH: !!cell.hf, flipV: !!cell.vf });
        }
      }
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
}
