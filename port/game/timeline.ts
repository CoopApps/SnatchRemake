// The intro timeline — the ORDER the port plays scenes back-to-back.
//
// Each scene has a `start` (vblank at which its sequence's phase 0 begins)
// relative to the *timeline start* (t=0 = the moment the port begins playing).
// The runtime maintains a global frame counter starting at 0 and calls each
// scene's render(globalFrame) — the scene's own SEQ_START anchor is subtracted
// internally, same as before.
//
// PROVENANCE: these `start` values came from measuring the capture (which
// vblank each scene began) then shifting so the very first scene starts at 0.
// They are the port's own game-timing constants now — nothing at runtime reads
// the capture, and the numbers stay stable regardless of what the capture does.

import type { PortScene } from './scenes/registry.ts';
import { konamiLogo } from './scenes/konami_logo.ts';
import { title } from './scenes/title.ts';
import { disclaimer } from './scenes/disclaimer.ts';
import { rss } from './scenes/rss.ts';
import { titleReveal as title_reveal } from './scenes/title_reveal.ts';
import { SCENES as ALL } from './scenes/registry.ts';
const byId = (id: string) => ALL.find(s => s.id === id)!;

export interface TimelineEntry {
  scene: PortScene;
  start: number;      // global vblank at which the scene's phase 0 begins
}

// Intro timeline. Only real ported scenes appear here — snapshot placeholders
// were removed 2026-08-09. title_reveal is a placeholder for the PRESS-ANY-KEY
// hold path only; the real gold SNATCHER title reveal isn't ported yet.
export const TIMELINE: TimelineEntry[] = [
  { scene: konamiLogo,   start: 0     },
  { scene: title,        start: 1334  }, // 2596 - 1262 (Konami SEQ_START offset)
  { scene: disclaimer,   start: 1897  }, // 3159 - 1262
  { scene: rss,                    start: 2558  }, // 3820 - 1262
  { scene: byId('dedication'),     start: 3655  }, // 4917
  { scene: byId('moscow_title'),   start: 4498  }, // 5760
  { scene: byId('junker_db'),      start: 5298  }, // 6560
  { scene: byId('neokobe_news'),   start: 7218  }, // 8480
  { scene: byId('wireframe_body'), start: 8978  }, // 10240
  { scene: title_reveal,           start: 10738 }, // 12000 — gold SNATCHER, holds for key
  { scene: byId('japan_map'),      start: 11778 }, // 13040
  { scene: byId('city_credits'),   start: 14578 }, // 15840
  { scene: byId('street_ident'),   start: 16978 }, // 18240
  { scene: byId('prod_credits'),   start: 18418 }, // 19680
  { scene: byId('portrait_katrina'), start: 21538 }, // 22800
  { scene: byId('portrait_gillian'), start: 22498 }, // 23760
];

// Scene checkpoints/render use "capture frame numbers" for harness scoring;
// the runtime plays back with a global t=0 timeline. This map converts each
// scene's timeline start to the capture-frame equivalent its render expects.
const SCENE_CAPTURE_ANCHOR: Record<string, number> = {
  konami_logo:  1262,
  title:        2596,
  disclaimer:   3159,
  rss:              3820,
  dedication:       4917,
  moscow_title:     5760,
  junker_db:        6560,
  neokobe_news:     8480,
  wireframe_body:  10240,
  japan_map:       13040,
  city_credits:    15840,
  street_ident:    18240,
  prod_credits:    19680,
  portrait_katrina:22800,
  portrait_gillian:23760,
  title_reveal:        0,   // placeholder scene ignores render-frame content
};

/** Which scene is playing at this global frame, and the render-frame it wants. */
export function activeSceneAt(globalFrame: number): { entry: TimelineEntry; renderFrame: number } {
  let active = TIMELINE[0];
  for (const e of TIMELINE) if (globalFrame >= e.start) active = e;
  const local = globalFrame - active.start;
  const anchor = SCENE_CAPTURE_ANCHOR[active.scene.id] ?? 0;
  return { entry: active, renderFrame: anchor + local };
}

/** Approximate total intro length in vblanks (last scene start + generous tail). */
export const TIMELINE_END = TIMELINE[TIMELINE.length - 1].start + 900;

/** Vblank at which the scene AFTER the one currently active starts, or null
 *  if we're already in the last scene. Used by the runtime to jump past a
 *  hold-for-input scene when the user presses a key. */
export function nextSceneStartAfter(globalFrame: number): number | null {
  let activeIdx = 0;
  for (let i = 0; i < TIMELINE.length; i++) if (globalFrame >= TIMELINE[i].start) activeIdx = i;
  return TIMELINE[activeIdx + 1]?.start ?? null;
}
