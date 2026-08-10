// Browser entry: preloads every scene's bundled assets, then starts the
// runtime loop against the canvas.

import { preloadScene } from './assets/loader.ts';
import { TIMELINE } from './timeline.ts';
import { attachRuntime } from './runtime.ts';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const status = document.getElementById('status')!;

async function boot() {
  status.textContent = 'loading assets…';
  const ids = Array.from(new Set(TIMELINE.map(t => t.scene.id)));
  await Promise.all(ids.map(id => preloadScene(id)));
  status.textContent = `loaded ${ids.length} scenes — playing`;

  const rt = attachRuntime(canvas, status);
  document.getElementById('btn-restart')!.addEventListener('click', () => rt.restart());
  document.getElementById('btn-pause')!.addEventListener('click', () => rt.toggle());
  document.getElementById('btn-slow')!.addEventListener('click', () => rt.setSpeed(0.5));
  document.getElementById('btn-fast')!.addEventListener('click', () => rt.setSpeed(2));
  rt.start();
}
boot().catch(e => { status.textContent = 'error: ' + e.message; console.error(e); });
