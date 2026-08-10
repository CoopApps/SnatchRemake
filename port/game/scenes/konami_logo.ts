// Scene: the Konami sequence — reveal wipe, gold marquee, white fade.
// TRUE PORT — bundled assets only. All disc data was baked at build time.

import { Screen, type RgbFrame, type Palette } from '../render/screen.ts';
import { loadScene, wordToRgb } from '../assets/loader.ts';
import { KonamiSequence, type KonamiTables } from '../engine/konami_seq.ts';

interface Cell { c: number; r: number; tile: number; pal: number; hf: number; vf: number; }
interface Layout { originCol: number; originRow: number; cells: Cell[]; tileToDisc: Record<string, number>; }

let cached: { upTo: number; seq: KonamiSequence } | null = null;
function seqAt(f: number, t: KonamiTables): KonamiSequence {
  if (!cached || cached.upTo > f || cached.seq.done) cached = { upTo: 0, seq: new KonamiSequence(t) };
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

const SEQ_START = 1262;

export const konamiLogo = {
  id: 'konami_logo',
  width: 256,
  height: 224,
  checkpoints: [1550, 1660, 1770],
  render(frame: number): RgbFrame {
    const assets = loadScene('konami_logo');
    const layout = assets.layout as Layout;
    // Palette line 3 (the raster-bar green ramp) comes straight from the disc
    // palette block — assets.paletteWords[3] is MAINCPU_IP $151e, byte-exact.
    const tables = { ...(assets.engineTables as unknown as KonamiTables),
                     line3_ramp: assets.paletteWords[3] } as KonamiTables;
    const seq = seqAt(Math.max(0, frame - SEQ_START), tables);
    const pals = shadowToPalettes(seq.shadow, 4);

    const screen = new Screen(256, 224);
    screen.clear(pals[0][0]);
    if (seq.whiteBg) screen.clear({ r: 239, g: 239, b: 239 });

    const maskY = seq.maskY();
    if (maskY !== null || seq.e04a >= 5) {
      for (const cell of layout.cells) {
        const discIdx = layout.tileToDisc[String(cell.tile)];
        if (discIdx === undefined || discIdx < 0) continue;
        const tile = assets.tiles[discIdx];
        if (!tile) continue;
        const x = (layout.originCol + cell.c) * 8;
        const y = (layout.originRow + cell.r) * 8;
        screen.drawTile(tile, x, y, pals[cell.pal] ?? pals[0], { flipH: !!cell.hf, flipV: !!cell.vf });
      }
    }

    if (maskY !== null && maskY < this.height) {
      const clip = Math.max(0, maskY);
      screen.fillRect(0, clip, this.width, this.height - clip, pals[0][0]);
    }

    // Raster bar — the green sweep. It is plane-A tiles 2 (top 8 rows) + 3
    // (bottom 8 rows), pal line 3, confirmed from the ROM (phase-2 fills the
    // nametable with these two tiles; HOW_SNATCHER_WORKS.md). BOTH the tile
    // pixels (MAINCPU_IP $15a0 block, tiles 2/3 = horizontal stripes) and the
    // palette (line 3 green ramp, $151e) are disc-sourced — no snapshot. The
    // engine gives the sweep's vertical position (lineY) and grown width.
    const lineY = seq.lineY();
    const barW = seq.barWidth();
    if (lineY !== null && barW > 0) {
      const t2 = assets.tiles[2], t3 = assets.tiles[3];
      const top = lineY - 5;   // sweep alignment (bar top = lineY-5)
      const drawTileBand = (tile: typeof t2, y0: number) => {
        if (!tile) return;
        for (let ty = 0; ty < 8; ty++) {
          const y = y0 + ty;
          if (y < 0 || y >= this.height) continue;
          // Each tile row is a uniform palette index → one horizontal line.
          const idx = tile[ty * 8];
          const w = seq.shadow[48 + idx];
          if (w === 0) continue;
          screen.fillRect(0, y, barW, 1, wordToRgb(w));
        }
      };
      drawTileBand(t2, top);
      drawTileBand(t3, top + 8);
    }

    return screen.frame();
  },
};
