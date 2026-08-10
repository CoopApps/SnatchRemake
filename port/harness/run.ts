// THE HARNESS — the only place allowed to touch the capture, and only to SCORE.
// Enforces the port is a real port:
//   1. boundary check  — port/game imports no capture / no VDP emulator (check_boundary.ts)
//   2. capture-hidden proof — rename the capture away, render every scene; if any
//      scene throws, it was secretly reading the capture -> FAIL.
//   3. score — compare each port scene's output to its reference target (offline
//      answer key). Fidelity only counts because (1)+(2) prove it was capture-free.
//
//   npx tsx port/harness/run.ts

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { renderScene } from '../game/main.ts';
import { SCENES } from '../game/scenes/registry.ts';
import { _resetAssetCache } from '../game/assets/loader.ts';
import { preloadAllScenes } from './preload.ts';

// The harness runs the port through Node; assets must be preloaded once before
// any render call. Top-level await is allowed in ESM.
await preloadAllScenes();

const HERE = import.meta.dirname;
const TARGETS = path.join(HERE, 'targets');
const CAPTURE = 'D:/completed ai projects/structural_carver/emulator/port/rendered/intro/state.bin';

console.log('\n  SNATCHER — TypeScript PORT harness');
console.log('  ' + '='.repeat(66));

// (1) boundary check
let boundaryOk = true;
try { console.log(execSync(`npx tsx "${path.join(HERE, 'check_boundary.ts')}"`, { encoding: 'utf8' }).trimEnd()); }
catch (e: any) { boundaryOk = false; console.log((e.stdout || '') + (e.stderr || '')); }

// (2) capture-hidden proof — hide state.bin, render everything, restore.
let proofOk = true;
const hidden = CAPTURE + '.hidden';
try {
  if (fs.existsSync(CAPTURE)) fs.renameSync(CAPTURE, hidden);
  for (const sc of SCENES) for (const cp of sc.checkpoints) { try { renderScene(sc.id, cp); } catch (e: any) { proofOk = false; console.log(`  ✗ ${sc.id}@${cp} FAILED with capture hidden: ${e.message} (it was reading the capture)`); } }
} finally { if (fs.existsSync(hidden)) fs.renameSync(hidden, CAPTURE); }
console.log(proofOk ? '  ✓ capture-hidden proof — every scene still renders with the capture removed' : '  ✗ capture-hidden proof FAILED');

// (3) DISC-HIDDEN PROOF — the true-port test. Rename the extracted disc
// directory away; the port must still render every scene. Clears the scene
// asset-loader's module cache first so the run genuinely re-reads files.
let discProofOk = true;
const DISC = 'D:/blastem/snatcher/extracted';
const discHidden = DISC + '__hidden_for_port_test';
try {
  if (fs.existsSync(DISC)) fs.renameSync(DISC, discHidden);
  // Reset the scene asset cache and reload from the bundled port/game/assets/
  // — those files must be sufficient with the disc gone. If preload succeeds
  // and every render succeeds, the port is genuinely disc-independent.
  _resetAssetCache();
  try { await preloadAllScenes(); }
  catch (e: any) { discProofOk = false; console.log(`  ✗ preload FAILED with disc hidden: ${e.message}`); }
  for (const sc of SCENES) for (const cp of sc.checkpoints) {
    try { renderScene(sc.id, cp); }
    catch (e: any) { discProofOk = false; console.log(`  ✗ ${sc.id}@${cp} FAILED with disc hidden: ${e.message}`); }
  }
} finally { if (fs.existsSync(discHidden)) fs.renameSync(discHidden, DISC); }
console.log(discProofOk ? '  ✓ disc-hidden proof — every scene still renders with the original disc removed' : '  ✗ disc-hidden proof FAILED — not a true port');

// (3) score
function loadTarget(id: string): { rgb: Uint8Array; w: number; h: number } | null {
  const p = path.join(TARGETS, `${id}.raw`);
  if (!fs.existsSync(p)) return null;
  const b = fs.readFileSync(p);
  return { w: b.readUInt16LE(0), h: b.readUInt16LE(2), rgb: new Uint8Array(b.subarray(4)) };
}
function score(a: { rgb: Uint8Array; width: number; height: number }, t: { rgb: Uint8Array; w: number; h: number }): number {
  const w = Math.min(a.width, t.w), h = Math.min(a.height, t.h); if (!w || !h) return 0;
  let close = 0, total = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const ia = (y * a.width + x) * 3, ib = (y * t.w + x) * 3; if (Math.abs(a.rgb[ia] - t.rgb[ib]) + Math.abs(a.rgb[ia + 1] - t.rgb[ib + 1]) + Math.abs(a.rgb[ia + 2] - t.rgb[ib + 2]) <= 24) close++; total++; }
  const sp = (Math.min(a.width, t.w) / Math.max(a.width, t.w)) * (Math.min(a.height, t.h) / Math.max(a.height, t.h));
  return (close / total) * sp * 100;
}

console.log('  ' + '-'.repeat(66));
let sum = 0, n = 0;
for (const sc of SCENES) {
  for (const cp of sc.checkpoints) {
    const t = loadTarget(`${sc.id}_${cp}`);
    const f = renderScene(sc.id, cp);
    if (!t) { console.log(`  ${(sc.id + '@' + cp).padEnd(24)} no target (make: make_target.ts ${sc.id}_${cp} ${cp})`); continue; }
    const fid = score(f, t); sum += fid; n++;
    console.log(`  ${(sc.id + '@' + cp).padEnd(24)} ${(fid.toFixed(1) + '%').padStart(7)}   ${'█'.repeat(Math.round(fid / 5)).padEnd(20, '·')}`);
  }
}
console.log('  ' + '-'.repeat(66));
const gate = boundaryOk && proofOk && discProofOk;
console.log(`  ${SCENES.length} scene(s), ${n} checkpoint(s)  ·  avg fidelity: ${n ? (sum / n).toFixed(1) : '0'}%  ·  guardrails: ${gate ? 'PASS' : 'FAIL (score does not count)'}`);
console.log('');
if (!gate) process.exit(1);
