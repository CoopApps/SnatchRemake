// Disclaimer-scene engine — phase driver (snap-in, hold, fade-out).
// TRUE PORT: takes the disc-derived palette words from the scene assets, never
// touches the disc itself. Uses the shared stepFadeToBlack_202a20 primitive
// (from MAINCPU_IP $202A20, factored into engine/palette_fx.ts).

import { stepFadeToBlack_202a20, isBlack } from './palette_fx.ts';

// AUTHORED-LAYOUT: observed hold duration (546 vblanks from f3160..f3706).
const HOLD_FRAMES = 546;

export class DisclaimerSequence {
  frame = 0;
  phase = 0;             // 0=snap-in, 1=hold, 2=fade-out
  holdCounter = 0;
  shadow = new Uint16Array(64);
  done = false;

  /** @param paletteWords bundled disc-derived palette words (line 0 required). */
  constructor(private readonly paletteWords: number[][]) {}

  tick(): void {
    this.frame++;
    switch (this.phase) {
      case 0: this.snapInPalette(); break;
      case 1: this.holdText(); break;
      case 2: this.fadeOutStep_reuses_202a20(); break;
      default: this.done = true;
    }
  }

  private snapInPalette(): void {
    for (let i = 0; i < 16; i++) this.shadow[i] = this.paletteWords[0][i];
    this.holdCounter = HOLD_FRAMES;
    this.phase = 1;
  }

  private holdText(): void {
    this.holdCounter--;
    if (this.holdCounter <= 0) this.phase = 2;
  }

  private fadeOutStep_reuses_202a20(): void {
    if ((this.frame & 1) === 0) stepFadeToBlack_202a20(this.shadow);
    if (isBlack(this.shadow)) this.done = true;
  }
}
