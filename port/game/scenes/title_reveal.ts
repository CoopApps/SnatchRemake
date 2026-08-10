// The gold SNATCHER title reveal — the game's PRESS-ANY-KEY hold screen.
//
// TRUE PORT — every byte from disc (see port/build/scenes.ts 'title_reveal'):
//   tiles     ← DATA_D0.BIN $2a70 + $360a (two LZSS blocks, full coverage)
//   palette   ← DATA_D0.BIN $36840 (4 lines)
//   nametable ← DATA_D0.BIN $37ea0 (LZSS)
// On top of the disc-sourced scene the port draws its own flashing
// "PRESS ANY KEY" prompt (port-authored UI text, like the timeline constants),
// and holdForInput freezes the runtime clock here until a key/click.

import type { RgbFrame } from '../render/screen.ts';
import { Screen } from '../render/screen.ts';
import { makePlaneAScene } from './_plane_a.ts';
import { drawText, textWidth } from '../render/text.ts';

const PROMPT = 'PRESS ANY KEY';
const PROMPT_COLOUR = { r: 239, g: 239, b: 239 };

const base = makePlaneAScene('title_reveal', [12000]);

export const titleReveal = {
  ...base,
  holdForInput: true as const,
  render(frame: number): RgbFrame {
    const fr = base.render(frame);
    // Flashing prompt at ~2Hz (on 32 vblanks / off 32), drawn into the frame.
    if ((frame >> 5) & 1) {
      const screen = new Screen(256, 224);
      screen.rgb.set(fr.rgb);
      drawText(screen, (256 - textWidth(PROMPT)) >> 1, 200, PROMPT, PROMPT_COLOUR);
      return screen.frame();
    }
    return fr;
  },
};
