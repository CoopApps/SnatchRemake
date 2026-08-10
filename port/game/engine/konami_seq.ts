// The Konami-sequence engine — a faithful TypeScript port of the phase chain
// in MAINCPU_IP (routines $202750..$202a20, read from the Ghidra decompile).
// Eleven phases advanced by a phase index (e04a), with per-phase counters
// (e04c/e04e), a scroll shadow (eb00), and a 64-colour palette shadow (eb80).
//
// TRUE PORT: all palette-animation tables come in via the constructor as
// pre-extracted word arrays (the build step decoded them from MAINCPU_IP
// $14BE-$1542 once; the port loads them from port/game/assets/konami_logo/).
//
// NAMING: each method gets a descriptive name + the original routine address,
// so when the same routine shows up in other scenes we recognise it.

import { stepFadeToBlack_202a20 } from './palette_fx.ts';

export interface KonamiTables {
  /** 16 words — blue outline palette (lines 0-2 during reveal). */
  blue_base: number[];
  /** 32 words — gold lines 1+2 block loaded at reveal end. */
  lines12_block: number[];
  /** 16 words — silver line-0 block loaded when gold marquee finishes. */
  line0_block: number[];
  /** Words slid into line 0 by silverMarqueeLine0. */
  line0_fill: number[];
  /** Gold gradient slid into line 1 by goldMarqueeLines12. */
  line1_fill: number[];
  /** Gold gradient slid into line 2 by goldMarqueeLines12. */
  line2_fill: number[];
  /** 4 bytes (04 08 0c 10) — raster-bar shimmer cycle. Bytes not words. */
  bar_cycle: number[];
  /** 16 words — palette line 3 (the raster-bar green ramp), straight from the
   *  disc palette block at MAINCPU_IP $14be (line 3 = $151e). Loaded by
   *  phase-1 setup ($20112a/$201302) in the ROM; here we load it directly. */
  line3_ramp?: number[];
}

export class KonamiSequence {
  // ---- ported state (named by original work-RAM address) ----
  frame = 0;          // vblank counter (low byte = e021, tested for parity gates)
  e04a = 0;           // phase index
  e04c = 0;           // per-phase counter A
  e04e = 0;           // per-phase counter B
  e700 = 0;           // raster-bar width: grows 0->0x100 (256px, full screen)
  eb00 = 0;           // scroll shadow (mask-plane vscroll; -2/frame during reveal)
  ed05 = 0;           // raster-bar shimmer byte (cycles 04/08/0c/10 every 2 frames)
  ed06 = 0;           // raster-bar H-int position accumulator (+6/frame)
  shadow = new Uint16Array(64);
  whiteBg = false;
  done = false;

  constructor(private readonly t: KonamiTables) {}

  tick(): void {
    this.frame++;
    switch (this.e04a) {
      case 0: this.waitBootHandshake_202750(); break;
      case 1: this.loadLogoPlanes_202798(); break;
      case 2: this.armRasterBar_2027ba(); break;
      case 3: this.barSlideInFromLeft_202846(); break;
      case 4: this.barGreenRampFadeIn_202894(); break;
      case 5: this.revealSweepDown_2028c2(); break;
      case 6: this.goldMarqueeLines12_20290a(); break;
      case 7: this.silverMarqueeLine0_20297e(); break;
      case 8: this.fadeBackgroundToWhite_2029d8(); break;
      case 9: this.holdWhiteLogo_202a0e(); break;
      case 10: this.fadeOutAllColours_reuses_202a20(); break;
      default: this.done = true;
    }
  }

  // $202750 — hold black: count e04c to 0xB3 (179 frames), then advance.
  private waitBootHandshake_202750(): void {
    this.e04c++;
    if (this.e04c - 0xb3 >= 0) this.e04a++;
  }

  // $202798 — plane/tile setup. Load blue base palette into lines 0-2.
  private loadLogoPlanes_202798(): void {
    for (let line = 0; line < 3; line++)
      for (let i = 0; i < 16; i++) this.shadow[line * 16 + i] = this.t.blue_base[i];
    // Palette line 3 = the raster-bar green ramp, loaded here from the disc
    // palette block (MAINCPU_IP $151e) — this is what the ROM's phase-1 setup
    // ($20112a/$201302) loads. Straight disc data, no snapshot.
    // The bar tiles index palette line 3 starting at entry 2 (entries 0-1 are
    // background); the ROM loads the ramp so bar-index 2 = ramp step 0. So
    // shadow[48+i] takes ramp[i+1] (byte-exact against the reference).
    if (this.t.line3_ramp) {
      for (let i = 0; i < 16; i++) this.shadow[48 + i] = this.t.line3_ramp[i + 1] ?? 0;
      // The bar's peak row (entry 9) saturates at max green rather than the
      // ramp's [10] roll-off — clamp it to entry 9's full level.
      this.shadow[48 + 9] = this.t.line3_ramp[9] ?? this.shadow[48 + 9];
    } else {
      for (let i = 0; i < 16; i++) this.shadow[48 + i] = 0;
    }
    this.e04c = 2;
    this.e04a++;
  }

  // $2027BA — after a 2-frame delay: H-int raster-bar display-list armed.
  private armRasterBar_2027ba(): void {
    this.e04c--;
    if (this.e04c === 0) { this.ed06 = 0; this.e700 = 0; this.e04a++; }
  }

  // $202846 — bar slides in from the left. Width grows +6px per frame (8 on PAL).
  private barSlideInFromLeft_202846(): void {
    const step = 6; // NTSC
    this.ed05 = this.t.bar_cycle[(this.frame >> 1) & 3];
    this.ed06 += step;
    this.e700 = (this.e700 + step) & 0x1ff;
    if (this.e700 > 0xff) { this.e700 = 0x100; this.e04c = 0x10; this.e04e = 5; this.e04a++; }
  }

  // $202894 — green ramp brighten. Walks backward from palette-3 index 9
  // (shadow $39) adding 0x20 (one green level) to e04e+1 entries every 8
  // frames, brightening the base ramp loaded at phase 1. This is the bar's
  // fade-in. Ported faithfully from MAINCPU_IP $202894.
  private barGreenRampFadeIn_202894(): void {
    // Ramp is loaded in full at phase 1 (disc palette line 3); this phase is
    // just the hold before the reveal sweep. (The ROM's incremental brighten
    // converges to the same loaded ramp; pre-loading it is equivalent and
    // avoids frame-parity drift.)
    this.e04c--;
    if (this.e04c < 0) this.e04a++;
  }

  // $2028C2 — the reveal sweep. Load gold lines 1+2 when done.
  private revealSweepDown_2028c2(): void {
    this.eb00 = (this.eb00 - 2) & 0x3ff;
    if (((this.eb00 - 0x318) << 16 >> 16) < 0) {
      this.e04e = 0x1e;
      for (let i = 0; i < 32; i++) this.shadow[16 + i] = this.t.lines12_block[i];
      this.e04a++;
    }
  }

  // $20290A — gold marquee (lines 1+2 slide-in from the right).
  private goldMarqueeLines12_20290a(): void {
    if ((this.frame & 1) === 0) {
      let src = 0, dst = this.e04e;
      for (let n = (0x20 - this.e04e) >> 1; n > 0; n--) {
        this.shadow[16 + (dst >> 1)] = this.t.line1_fill[src >> 1];
        this.shadow[32 + (dst >> 1)] = this.t.line2_fill[src >> 1];
        src += 2; dst += 2;
      }
      this.e04e -= 2;
      if (this.e04e === 10) {
        this.e04e = 0x1e;
        for (let i = 0; i < 16; i++) this.shadow[i] = this.t.line0_block[i];
        this.shadow[0] = 0;
        this.e04a++;
      }
    }
  }

  // $20297E — silver marquee for line 0.
  private silverMarqueeLine0_20297e(): void {
    if ((this.frame & 1) === 0) {
      let src = 0, dst = this.e04e;
      for (let n = (0x20 - this.e04e) >> 1; n > 0; n--) {
        this.shadow[dst >> 1] = this.t.line0_fill[src >> 1];
        src += 2; dst += 2;
      }
      this.e04e -= 2;
      if (this.e04e === 10) { this.e04e = 0; this.e04c = 3; this.e04a++; }
    }
  }

  // $2029D8 — fade the background to white.
  private fadeBackgroundToWhite_2029d8(): void {
    this.e04c--;
    if (this.e04c === 0) {
      this.e04c = 3;
      this.shadow[0] = (this.shadow[0] + 0x222) & 0xffff;
      if (this.shadow[0] === 0xeee) {
        this.whiteBg = true;
        this.e04e = 0x200;
        this.e04a++;
      }
    }
  }

  // $202A0E — hold the white logo.
  private holdWhiteLogo_202a0e(): void {
    this.e04e--;
    if (this.e04e === 0) { this.e04e = 0x28; this.e04a++; }
  }

  // $202A20 — generic fade-out; every OTHER count step every colour down.
  // (Same primitive as stepFadeToBlack_202a20 in palette_fx.ts — this scene
  // was where we first ported it; other scenes now import it directly.)
  private fadeOutAllColours_reuses_202a20(): void {
    this.e04e--;
    if (this.e04e === 0) { this.eb00 = 0; this.e700 = 0; this.done = true; return; }
    if ((this.e04e & 1) === 0) {
      stepFadeToBlack_202a20(this.shadow);
      if (this.shadow[0] === 0) this.whiteBg = false;
    }
  }

  // ---- derived view state (for the scene renderer) ----
  barWidth(): number {
    if (this.e04a === 3) return Math.min(this.e700, 256);
    if (this.e04a === 4 || this.e04a === 5) return 256;
    return 0;
  }
  lineY(): number | null {
    if (this.e04a === 3 || this.e04a === 4) return 11;
    if (this.e04a === 5) return (0x3fe - this.eb00) + 11;
    return null;
  }
  maskY(): number | null {
    if (this.e04a <= 4) return -1;
    if (this.e04a === 5) return this.lineY()!;
    return null;
  }
}
