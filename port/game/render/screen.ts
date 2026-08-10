// The port's OWN renderer — not the Genesis VDP. A plain RGB framebuffer the
// game code draws onto with tiles, sprites, and (later) text. No VRAM, no
// nametable, no CRAM — those are the original hardware's internals. This is our
// clean-room display: give it decoded tiles + an RGB palette and a position.

export interface Rgb { r: number; g: number; b: number; }
/** A decoded 8x8 tile: 64 palette indices (0..15), index 0 = transparent. */
export type Tile = Uint8Array; // length 64
/** A 16-colour palette as RGB. */
export type Palette = Rgb[];

export interface RgbFrame { rgb: Uint8Array; width: number; height: number; }

export class Screen {
  readonly rgb: Uint8Array;
  constructor(readonly width: number, readonly height: number) {
    this.rgb = new Uint8Array(width * height * 3);
  }

  clear(c: Rgb = { r: 0, g: 0, b: 0 }): void {
    for (let i = 0; i < this.rgb.length; i += 3) { this.rgb[i] = c.r; this.rgb[i + 1] = c.g; this.rgb[i + 2] = c.b; }
  }

  /** Draw one 8x8 tile at pixel (px,py). index 0 = transparent unless opaque0. */
  drawTile(tile: Tile, px: number, py: number, pal: Palette, opts: { flipH?: boolean; flipV?: boolean; opaque0?: boolean } = {}): void {
    for (let ty = 0; ty < 8; ty++) {
      const sy = opts.flipV ? 7 - ty : ty;
      const oy = py + ty;
      if (oy < 0 || oy >= this.height) continue;
      for (let tx = 0; tx < 8; tx++) {
        const sx = opts.flipH ? 7 - tx : tx;
        const idx = tile[sy * 8 + sx];
        if (idx === 0 && !opts.opaque0) continue;
        const ox = px + tx;
        if (ox < 0 || ox >= this.width) continue;
        const c = pal[idx];
        const di = (oy * this.width + ox) * 3;
        this.rgb[di] = c.r; this.rgb[di + 1] = c.g; this.rgb[di + 2] = c.b;
      }
    }
  }

  /** Fill a whole tile-cell area with a background colour (opaque). */
  fillRect(x: number, y: number, w: number, h: number, c: Rgb): void {
    for (let yy = y; yy < y + h && yy < this.height; yy++) for (let xx = x; xx < x + w && xx < this.width; xx++) {
      if (yy < 0 || xx < 0) continue;
      const di = (yy * this.width + xx) * 3; this.rgb[di] = c.r; this.rgb[di + 1] = c.g; this.rgb[di + 2] = c.b;
    }
  }

  /**
   * Draw one Genesis hardware sprite: a wTiles×hTiles block of 8×8 tiles, drawn
   * OVER the background planes with palette-index 0 transparent. Sprite tiles are
   * stored column-major in VRAM (consecutive indices run DOWN a column, then the
   * next column) — the VDP's sprite tile order — so tile at (col,row) is
   * `tiles[tileBase + col*hTiles + row]`. flipH/flipV mirror the whole sprite
   * (both the cell order AND each tile), matching hardware. (px,py) is the
   * top-left screen pixel of the sprite after any flip.
   */
  drawSprite(
    tiles: Tile[], tileBase: number, px: number, py: number, pal: Palette,
    wTiles: number, hTiles: number, opts: { flipH?: boolean; flipV?: boolean } = {},
  ): void {
    for (let col = 0; col < wTiles; col++) {
      for (let row = 0; row < hTiles; row++) {
        const tile = tiles[tileBase + col * hTiles + row];
        if (!tile) continue;
        const cellCol = opts.flipH ? wTiles - 1 - col : col;
        const cellRow = opts.flipV ? hTiles - 1 - row : row;
        this.drawTile(tile, px + cellCol * 8, py + cellRow * 8, pal, { flipH: opts.flipH, flipV: opts.flipV });
      }
    }
  }

  frame(): RgbFrame { return { rgb: this.rgb, width: this.width, height: this.height }; }
}

/** One sprite placement in a scene, sourced from the disc's sprite descriptors. */
export interface SpritePlacement {
  tileBase: number;  // index into the scene's sprite tile block
  x: number; y: number;
  wTiles: number; hTiles: number;
  pal: number;
  flipH?: boolean; flipV?: boolean;
  pri?: boolean;     // priority over background (z-order); false = behind priority-1 bg
}
