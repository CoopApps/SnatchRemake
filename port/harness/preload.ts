// Harness helper — preload every port scene's assets before rendering.
// Every harness script (run.ts, compare_*.ts, animate.ts, make_target.ts)
// should await preloadAllScenes() at startup so loadScene() calls succeed.

import { preloadScene } from '../game/assets/loader.ts';
import { SCENES } from '../game/scenes/registry.ts';

export async function preloadAllScenes(): Promise<void> {
  const ids = Array.from(new Set(SCENES.map(s => s.id)));
  await Promise.all(ids.map(id => preloadScene(id)));
}
