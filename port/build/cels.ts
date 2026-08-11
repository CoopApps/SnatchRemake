// Decode a sprite "cel" (one animation keyframe) from a disc descriptor list.
//
// A descriptor list is a run of 8-byte records, each 4 big-endian words:
//   +0 Yoff.w   (signed) sprite Y offset from the object origin
//   +2 basePos.w  high byte = VDP size nibble; low byte = link (0 in source data)
//   +4 attr.w   VDP attribute: palette<<13 | vflip<<12 | hflip<<11 | tile(0..0x7ff)
//   +6 Xoff.w   (signed) sprite X offset from the object origin
//
// The hardware emitter is linear: SAT.X = origin.x + Xoff, SAT.Y = origin.y + Yoff
// (verified against the intro portrait, RESEARCH_LOG cont.36). Tiles are laid out
// column-major within a sprite.

export interface CelSprite {
  tile: number;      // base tile index into the cel's tileset
  pal: number;       // palette line 0..3
  hf: boolean; vf: boolean;
  w: number; h: number;   // size in 8x8 tiles (1..4 each)
  dx: number; dy: number; // offset from the cel origin
}

export interface Cel {
  origin: { x: number; y: number };
  sprites: CelSprite[];
  source: { offset: number; records: number };
}

const be16 = (d: Uint8Array, a: number) => (d[a] << 8) | d[a + 1];
const sbe16 = (d: Uint8Array, a: number) => { const v = be16(d, a); return v & 0x8000 ? v - 0x10000 : v; };

/** Decode the descriptor list at `offset`, stopping at the first invalid record. */
export function decodeCel(disc: Uint8Array, offset: number, origin: { x: number; y: number }, maxRecords = 64): Cel {
  const sprites: CelSprite[] = [];
  for (let i = 0; i < maxRecords; i++) {
    const a = offset + i * 8;
    if (a + 8 > disc.length) break;
    const yoff = sbe16(disc, a);
    const sizeWord = be16(disc, a + 2);
    const attr = be16(disc, a + 4);
    const xoff = sbe16(disc, a + 6);
    const size = sizeWord >> 8, link = sizeWord & 0xff;
    if (size < 1 || size > 0x0f || link !== 0) break;      // end of list
    if (Math.abs(xoff) > 256 || Math.abs(yoff) > 256) break;
    const tile = attr & 0x7ff;
    if (tile === 0) continue;                               // slot-0 marker
    sprites.push({
      tile, pal: (attr >> 13) & 3, hf: !!((attr >> 11) & 1), vf: !!((attr >> 12) & 1),
      w: ((size >> 2) & 3) + 1, h: (size & 3) + 1, dx: xoff, dy: yoff,
    });
  }
  return { origin, sprites, source: { offset, records: sprites.length } };
}
