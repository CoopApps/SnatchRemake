// Runtime loop for the port. Advances a global vblank counter, asks the
// timeline which scene is active, calls that scene's render(frame), and blits
// the RGB buffer to a canvas. No emulator, no capture — pure port.

import { activeSceneAt, TIMELINE_END, nextSceneStartAfter } from './timeline.ts';

export interface Runtime {
  start(): void;
  stop(): void;
  restart(): void;
  setSpeed(mult: number): void;
  toggle(): void;
  get status(): string;
}

/** Genesis vertical rate — the port uses the same 60Hz cadence as the source. */
const VBLANK_HZ = 60;

export function attachRuntime(canvas: HTMLCanvasElement, statusEl?: HTMLElement): Runtime {
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(canvas.width, canvas.height);

  let frame = 0;
  let running = false;
  let raf = 0;
  let speed = 1;
  let last = 0;
  let acc = 0;
  let currentSceneId = '';
  // Hold-for-input state: when playing a scene that sets holdForInput, the
  // runtime freezes the clock at the LAST vblank still inside that scene until
  // a key is pressed, then unfreezes and jumps to the next scene.
  let holding = false;
  let holdReleasedByKey = false;

  function onKey(): void {
    if (holding) {
      holdReleasedByKey = true;
      // Advance one vblank past the current scene's window so activeSceneAt()
      // returns the NEXT scene on the next tick, releasing the hold.
      const next = nextSceneStartAfter(frame);
      if (next !== null) frame = next;
      holding = false;
    }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKey);
    canvas.addEventListener('click', onKey);
  }

  function draw(): void {
    const { entry, renderFrame } = activeSceneAt(frame);
    if (entry.scene.id !== currentSceneId) currentSceneId = entry.scene.id;
    const rgb = entry.scene.render(renderFrame).rgb;
    // rgb is packed RGB (W*H*3); canvas ImageData is RGBA (W*H*4). Expand.
    const dst = img.data;
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
      dst[j] = rgb[i]; dst[j + 1] = rgb[i + 1]; dst[j + 2] = rgb[i + 2]; dst[j + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    if (statusEl) {
      const heldMark = holding ? ' · waiting for key' : '';
      statusEl.textContent = `t=${frame}v · scene ${currentSceneId} · ${speed}×${heldMark}`;
    }
  }

  function tick(now: number): void {
    if (!running) return;
    if (last === 0) last = now;
    const dt = Math.min(0.25, (now - last) / 1000); // clamp large gaps
    last = now;
    acc += dt * VBLANK_HZ * speed;
    while (acc >= 1) {
      // If the CURRENT scene wants to hold, freeze the clock inside its
      // window until a key press releases it. The scene keeps rendering (so
      // its flashing prompt still animates) but `frame` doesn't advance past
      // the hold point — we still bump it inside a small local window so the
      // prompt-flash phase still cycles.
      const { entry } = activeSceneAt(frame);
      if (entry.scene.holdForInput && !holdReleasedByKey) {
        holding = true;
        const start = entry.start;
        const local = (frame - start + 1) % 120;   // 2s local loop for the flash
        frame = start + local;
        acc = 0;
        break;
      }
      holdReleasedByKey = false;
      frame++; acc -= 1;
    }
    if (frame >= TIMELINE_END) frame = 0; // loop the intro for now
    draw();
    raf = requestAnimationFrame(tick);
  }

  return {
    start() { if (running) return; running = true; last = 0; raf = requestAnimationFrame(tick); },
    stop()  { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    restart() { frame = 0; acc = 0; draw(); },
    setSpeed(mult: number) { speed = mult; },
    toggle() { running ? this.stop() : this.start(); },
    get status() { return `${running ? 'playing' : 'paused'} · f${frame}`; },
  };
}
