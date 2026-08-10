// BUILD-TIME: precompute an index of every valid LZSS block on disc.
// Each disc file is scanned once; every offset with a plausible u16 BE size
// prefix that decompresses cleanly is recorded (file, offset, size, first
// 128 bytes of decoded output). The index is cached to disc so re-runs are
// instant. Downstream: hunt_scene can look up "which block starts with these
// bytes?" in O(entries) instead of O(offsets × decompress).

import fs from 'node:fs'; import path from 'node:path';
import { decompressLzss } from './lzss.ts';

export interface LzssBlockEntry {
  file: string;
  off: number;
  size: number;         // u16 BE size prefix
  decodedLen: number;
  headHex: string;      // first 128 bytes of decoded output, hex
}

const CACHE_PATH = path.join(import.meta.dirname, '.lzss_index.json');
const DISC = 'D:/blastem/snatcher/extracted';

export function loadIndex(): LzssBlockEntry[] {
  if (fs.existsSync(CACHE_PATH)) {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  }
  console.log(`[lzss_index] building — scanning all disc files...`);
  // Only scan files that hold scene tile/nametable data. SP*.BIN / PCMLD_*.BIN
  // are speech + PCM audio and consist of noise that "successfully" LZSS-
  // decompresses at thousands of offsets (false positives), and no scene
  // graphics live there. DATA_D*/DATA_A0/BOOT_SP/MAINCPU_IP cover everything
  // the intro loads.
  const files = fs.readdirSync(DISC).filter(f =>
    /\.BIN$/i.test(f) && /^(DATA_|BOOT_SP|MAINCPU_IP)/i.test(f) && !/^DATA_[CE]/i.test(f));
  const entries: LzssBlockEntry[] = [];
  const t0 = Date.now();
  for (const f of files) {
    const d = fs.readFileSync(path.join(DISC, f));
    const cap = Math.min(d.length, 0x40000);
    let found = 0;
    for (let off = 0; off + 4 < cap; off += 2) {
      const sz = (d[off] << 8) | d[off + 1];
      // Same range as the hunter uses for tile blocks / nametables.
      if (sz < 0x100 || sz > 0x10000) continue;
      try {
        const dec = Buffer.from(decompressLzss(d, off + 2, sz));
        if (dec.length < 64) continue;
        // Also require the decompressor consumed roughly the size prefix
        // (Konami's prefix is the DECOMPRESSED size — my earlier confirmation
        // for tiles at $310a: prefix $2000 → decoded 8192). Reject if wildly off.
        if (Math.abs(dec.length - sz) > sz / 4) continue;
        entries.push({ file: f, off, size: sz, decodedLen: dec.length, headHex: dec.subarray(0, 128).toString('hex') });
        found++;
      } catch { }
    }
    console.log(`[lzss_index]   ${f}: ${found} blocks`);
  }
  fs.writeFileSync(CACHE_PATH, JSON.stringify(entries));
  console.log(`[lzss_index] indexed ${entries.length} blocks across ${files.length} files in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${CACHE_PATH}`);
  return entries;
}

/** Find blocks whose decoded output CONTAINS this needle in its first 128 bytes. */
export function findBlockByHead(index: LzssBlockEntry[], needle: Buffer): LzssBlockEntry[] {
  const nh = needle.toString('hex');
  return index.filter(e => e.headHex.indexOf(nh) === 0 || e.headHex.indexOf(nh) % 2 === 0 && e.headHex.indexOf(nh) >= 0);
}
