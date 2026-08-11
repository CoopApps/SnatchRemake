// Runtime cel compositor — draws one animation keyframe (a "cel") onto the screen.
//
// This is the ported hardware sprite emitter: each cel sprite is placed at
// (origin + offset) and composited via the VDP-style drawSprite (column-major
// tiles, colour-0 transparent, flip). Earlier sprites in the list have display
// priority, so we draw back-to-front (reverse order).
//
// A cel's pixels come from its tileset (disc-decoded tiles) and its palette
// (disc-decoded RGB). Nothing here touches a capture or the disc at runtime.

import { Screen, type Tile, type Palette } from '../render/screen.ts';

export interface CelSprite {
  tile: number; pal: number; hf: boolean; vf: boolean;
  w: number; h: number; dx: number; dy: number;
}
export interface Cel {
  origin: { x: number; y: number };
  sprites: CelSprite[];
}

/**
 * Composite a cel onto the screen over whatever is already drawn (background).
 * `tiles` is the cel's tileset indexed by sprite.tile; `palettes` is the
 * scene's 4 palette lines.
 */
export function drawCel(screen: Screen, cel: Cel, tiles: Tile[], palettes: Palette[]): void {
  for (let i = cel.sprites.length - 1; i >= 0; i--) {   // back-to-front = SAT priority
    const s = cel.sprites[i];
    const pal = palettes[s.pal] ?? palettes[0];
    screen.drawSprite(tiles, s.tile, cel.origin.x + s.dx, cel.origin.y + s.dy,
      pal, s.w, s.h, { flipH: s.hf, flipV: s.vf });
  }
}
