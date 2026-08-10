// ENFORCEMENT #1 — the port must never read the capture or emulate the Genesis.
// Greps port/game/** for forbidden imports/paths and EXITS NON-ZERO if found.
// Run every turn (wired into run.ts + the Stop hook). This is not my goodwill;
// it's a build gate. If the port drifts back into reading the capture or using
// the VDP emulator, this goes red and everyone sees it.

import fs from 'node:fs';
import path from 'node:path';

const GAME = path.join(import.meta.dirname, '..', 'game');

// Things the PORT (port/game) is forbidden to touch. It is a clean-room
// reimplementation: its own renderer, its own game code, decoded disc assets.
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /src\/render\/vdp/, why: 'imports the Genesis VDP emulator (the port has its OWN renderer)' },
  { pattern: /\bvdp\b/i, why: 'references the VDP emulator / Genesis VRAM model' },
  { pattern: /state\.bin|\.state\b/, why: 'reads a capture state file' },
  { pattern: /_prgram|_workram|_vram|_cram|_vsram|_vdpreg/, why: 'reads a raw capture dump' },
  { pattern: /rendered\/intro|\/output\/|gpgx_harness/, why: 'reads the capture output directory' },
  { pattern: /harness\/targets|reference/i, why: 'reads the harness answer-key (capture-derived)' },
  { pattern: /\bnametable\b|\bcram\b|\bvsram\b/i, why: 'builds Genesis hardware memory (emulation, not a port renderer)' },
  // TRUE-PORT rules — the port never touches the original disc, only bundled assets.
  { pattern: /snatcher\/extracted|\/extracted\//, why: 'reads the extracted original disc directory (port must use bundled assets)' },
  { pattern: /\bdiscFile\s*\(|\bdecompressLzss\s*\(|from ['"][^'"]*build\//, why: 'runs disc-decoding logic (belongs in port/build/, not port/game/)' },
  { pattern: /(MAINCPU_IP|SUBCODE|BOOT_SP|DATA_[A-Z0-9_]+)\.BIN\b/i, why: 'names a raw disc file (port must not know disc filenames — bundled assets only)' },
  { pattern: /\bLZSS\b/, why: 'references LZSS compression (belongs in port/build/)' },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.hooks' || e.name === 'data' || e.name.startsWith('_')) continue; // harness hooks & authored data
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

let violations = 0;
if (fs.existsSync(GAME)) {
  for (const file of walk(GAME)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const t = line.trimStart();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return; // comments may mention these
      for (const f of FORBIDDEN) {
        if (f.pattern.test(line)) {
          console.error(`  ✗ ${path.relative(GAME, file)}:${i + 1}  ${f.why}\n      ${line.trim()}`);
          violations++;
        }
      }
    });
  }
}

// ENFORCEMENT #2 — every port asset must be sourced from disc via port/build/,
// never harvested from a reference-VRAM snapshot. Any manifest containing
// AUTHORED-SNAPSHOT or AUTHORED-LAYOUT is a violation. This closed a real
// loophole 2026-08-09 where 17 scenes were shipped as VRAM stills sliced from
// state.bin and dressed up as "assets" — the disc-hidden guardrail didn't
// catch it because the bundled bytes lived under port/game/assets/.
const ASSETS = path.join(import.meta.dirname, '..', 'game', 'assets');
const SNAPSHOT_MARKERS = /AUTHORED-SNAPSHOT|AUTHORED-LAYOUT/;
if (fs.existsSync(ASSETS)) {
  for (const scene of fs.readdirSync(ASSETS)) {
    const dir = path.join(ASSETS, scene);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (!/\.(json|md)$/.test(f)) continue;
      const text = fs.readFileSync(p, 'utf8');
      if (SNAPSHOT_MARKERS.test(text)) {
        console.error(`  ✗ ${path.relative(path.join(import.meta.dirname, '..'), p)}  contains AUTHORED-SNAPSHOT / AUTHORED-LAYOUT marker`);
        console.error(`      snapshot-authored assets do not belong in the port — extract from disc via port/build/scenes.ts`);
        violations++;
      }
    }
  }
}

if (violations > 0) {
  console.error(`\n  BOUNDARY VIOLATION: ${violations} — the port reached into the capture/emulator. It is NOT a port.`);
  process.exit(1);
}
console.log('  ✓ boundary clean — port/game reads no capture, no VDP emulator, no snapshot assets');
