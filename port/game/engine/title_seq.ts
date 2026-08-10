// Title-screen sequence engine — snap-in, hold, fade-out.
// TRUE PORT: takes bundled palette words in constructor. All 4 lines loaded
// (title uses palettes 0..3 for different regions of the graphic).

import { stepFadeToBlack_202a20, isBlack } from './palette_fx.ts';

// AUTHORED-LAYOUT: observed hold length (attract-mode ~407 vblanks).
const HOLD_FRAMES = 407;

export class TitleSequence {
  frame = 0;
  phase = 0;
  holdCounter = 0;
  shadow = new Uint16Array(64);
  done = false;

  constructor(private readonly paletteWords: number[][]) {}

  tick(): void {
    this.frame++;
    switch (this.phase) {
      case 0: this.snapInPalette(); break;
      case 1: this.holdAttract(); break;
      case 2: this.fadeOutStep_reuses_202a20(); break;
      default: this.done = true;
    }
  }

  private snapInPalette(): void {
    for (let line = 0; line < this.paletteWords.length; line++)
      for (let i = 0; i < 16; i++) this.shadow[line * 16 + i] = this.paletteWords[line][i];
    this.holdCounter = HOLD_FRAMES;
    this.phase = 1;
  }

  private holdAttract(): void {
    this.holdCounter--;
    if (this.holdCounter <= 0) this.phase = 2;
  }

  private fadeOutStep_reuses_202a20(): void {
    if ((this.frame & 1) === 0) stepFadeToBlack_202a20(this.shadow);
    if (isBlack(this.shadow)) this.done = true;
  }
}
