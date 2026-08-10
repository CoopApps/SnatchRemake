// RSS-credit sequence engine — snap-in, hold, fade-out. TRUE PORT: takes
// disc-derived palette words from the scene assets. Reuses stepFadeToBlack_202a20.

import { stepFadeToBlack_202a20, isBlack } from './palette_fx.ts';

// AUTHORED-LAYOUT: observed hold length (f3820..f4380 = 560 vblanks).
const HOLD_FRAMES = 560;

export class RssSequence {
  frame = 0;
  phase = 0;
  holdCounter = 0;
  shadow = new Uint16Array(64);
  done = false;

  constructor(private readonly paletteWords: number[][]) {}

  tick(): void {
    this.frame++;
    switch (this.phase) {
      case 0: this.snapIn(); break;
      case 1: this.holdCredit(); break;
      case 2: this.fadeOut_reuses_202a20(); break;
      default: this.done = true;
    }
  }
  private snapIn(): void {
    for (let i = 0; i < 16; i++) this.shadow[i] = this.paletteWords[0][i];
    this.holdCounter = HOLD_FRAMES;
    this.phase = 1;
  }
  private holdCredit(): void {
    this.holdCounter--;
    if (this.holdCounter <= 0) this.phase = 2;
  }
  private fadeOut_reuses_202a20(): void {
    if ((this.frame & 1) === 0) stepFadeToBlack_202a20(this.shadow);
    if (isBlack(this.shadow)) this.done = true;
  }
}
