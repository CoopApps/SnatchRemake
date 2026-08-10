// The port's scene list, in play order. Pure TypeScript, no capture, no
// snapshots. Each scene renders itself from disc-decoded assets and ported
// engine code. The list intentionally shrinks (rather than grows) when work
// isn't real — snapshot-authored placeholders were removed 2026-08-09 after
// they were caught violating the no-captured-data-in-port rule. Real scenes
// join the list only when they render from ported code + disc-sourced bytes
// with disc-hidden AND capture-hidden proofs green.

import type { RgbFrame } from '../render/screen.ts';
import { konamiLogo } from './konami_logo.ts';
import { title } from './title.ts';
import { disclaimer } from './disclaimer.ts';
import { rss } from './rss.ts';
import { titleReveal as title_reveal } from './title_reveal.ts';
import { junkerDb as junker_db } from './junker_db.ts';
import { portraitGillian as portrait_gillian } from './portrait_gillian.ts';
import { makePlaneAScene } from './_plane_a.ts';

// Scenes built on the shared plane-A helper — nothing snapshot-y; every one
// listed here has an entry in port/build/scenes.ts with real disc offsets.
const wireframe_body   = makePlaneAScene('wireframe_body',   [10240]);
const neokobe_news     = makePlaneAScene('neokobe_news',     [8480]);
const portrait_katrina = makePlaneAScene('portrait_katrina', [22800]);
const dedication       = makePlaneAScene('dedication',       [5000, 5100]);
const moscow_title     = makePlaneAScene('moscow_title',     [5760]);
const city_credits     = makePlaneAScene('city_credits',     [15840]);
const street_ident     = makePlaneAScene('street_ident',     [18240]);
const japan_map        = makePlaneAScene('japan_map',        [13040]);
const prod_credits     = makePlaneAScene('prod_credits',     [19680]);

export interface PortScene {
  id: string;
  width: number;
  height: number;
  /** Render the scene at capture-frame `frame`. */
  render(frame: number): RgbFrame;
  /** Capture frames to score against (spread across the animation). */
  checkpoints: number[];
  /** When true, the runtime clock stops at this scene's start and only
   *  resumes on a keypress. Used by the title-screen "PRESS ANY KEY" hold. */
  holdForInput?: boolean;
}

export const SCENES: PortScene[] = [
  konamiLogo,
  title,
  disclaimer,
  rss,
  dedication,
  moscow_title,
  junker_db,
  portrait_gillian,
  wireframe_body,
  neokobe_news,
  portrait_katrina,
  japan_map,
  city_credits,
  street_ident,
  prod_credits,
  // title_reveal: the REAL gold SNATCHER reveal (disc-sourced, two tile
  // blocks) + port-authored PRESS ANY KEY overlay + holdForInput.
  title_reveal,
];

export function sceneById(id: string): PortScene | undefined {
  return SCENES.find(s => s.id === id);
}
