# SnatchRemake

A **true TypeScript port** of the intro sequence of *Snatcher* (Konami, Sega CD, 1994) —
rebuilt scene-by-scene from the disc's own decoded assets, as if the game were being
authored in TypeScript from scratch.

## What "true port" means here

The project holds itself to three hard rules, enforced automatically by the scoring
harness (`port/harness/run.ts`):

1. **No captures.** Nothing in `port/game/` may read a VRAM/SAT/state dump. The renderer
   is a small Genesis-VDP-style tile compositor fed only by decoded disc assets.
2. **No disc at runtime.** Assets are decoded ahead of time (Konami LZSS + palette/nametable
   decoders in `port/build/`) into `port/game/assets/`. The game renders with the original
   disc absent — proven each run by the *disc-hidden* guardrail.
3. **Every pixel is traceable** to disc bytes + ported code — no hand-drawn approximations,
   no snapshot-derived layouts.

The emulator is used **only** as an offline oracle to score fidelity, never as a source of
shipped bytes.

## Status

Intro sequence: **16 scenes, avg ~93% fidelity vs reference**, all guardrails passing.
Konami logo, title, disclaimer, RSS credit, dedication, Moscow title, JUNKER database,
character portraits, wireframe, newspaper, Japan map, city/production credits, neon street,
and the gold SNATCHER title reveal all render from disc-decoded assets.

Remaining work funnels into one subsystem — the Sub-CPU **sprite engine** (animated
portrait faces, bio-cells, the Konami raster bar) — which is careful m68k RE, in progress.

## Game data is not included

This repo contains **code only**. The decoded Konami graphics, disc-derived layout/palette
data, and reference framebuffers are Konami's copyrighted material and are **git-ignored**
(see `.gitignore`). To run locally you regenerate them from *your own* legally-owned Snatcher
Sega CD disc via the decoders in `port/build/`.

## Running the scorer

```bash
npm install
npm run score      # renders every scene, checks guardrails, prints the fidelity board
```

(Requires the locally-regenerated assets under `port/game/assets/`.)

## Layout

```
port/
  game/        the port itself — scenes, engine, VDP-style renderer, asset loader
    scenes/    one module per intro scene
    engine/    per-scene animation sequencers (ported from the ROM's phase handlers)
    render/    tile/nametable/palette -> RGB compositor
    assets/    decoded disc assets (git-ignored; regenerated from disc)
  build/       disc decoders — Konami LZSS, tile/nametable/palette extraction
  harness/     fidelity scorer + no-capture / no-disc guardrails + reference targets
```
