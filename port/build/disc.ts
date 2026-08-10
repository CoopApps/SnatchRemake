// Disc access — the port reads the extracted Snatcher disc files (and nothing
// else). These are the real game data pressed on the CD; decoding them is the
// whole point. No capture, no emulator state.

import fs from 'node:fs';
import path from 'node:path';

const EXTRACTED = 'D:/blastem/snatcher/extracted';

const _cache = new Map<string, Uint8Array>();

/** Read an extracted disc file by name, e.g. discFile('MAINCPU_IP.BIN'). */
export function discFile(name: string): Uint8Array {
  let b = _cache.get(name);
  if (!b) { b = new Uint8Array(fs.readFileSync(path.join(EXTRACTED, name))); _cache.set(name, b); }
  return b;
}
