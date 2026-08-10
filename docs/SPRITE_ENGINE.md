# Snatcher intro sprite engine — reverse-engineered

Status: **emitter + descriptor format decoded and verified.** This documents how the
sub-CPU turns disc-stored sprite descriptors into the Genesis sprite-attribute table
(SAT), so the port can regenerate sprites from disc data (no captured SAT).

The emulator (Genesis Plus GX, rebuilt with a `sat[]`-cache memory ID) was used only
as a guidance oracle; all shipped data comes from the disc.

## Where things live

- **Sprite tiles**: raw-decompressed LZSS streams in `DATA_D0.BIN`. Gillian portrait:
  - `$226b2` → 256 tiles → VRAM `$a0–$11f` (head)
  - `$236dc` → 256 tiles → VRAM `$100–$1ff` (woman)
  - `$24bb8` → 29 tiles → VRAM `$200–$21b` (pal-2 collar)
  - Tiles are stored in **sprite-decomposition order** (NOT image row-major — a naive
    grid blit is noise). The descriptor list defines the arrangement.
- **Sprite descriptor lists**: raw in `DATA_D2.BIN`, a table region around `$128xx–$130xx`.
  Verified example: the title screen's "NEW GAME" object (`$7f00`) list at **`$12718`**.

## Descriptor record — 8 bytes, 4 big-endian words

```
w0: attr        (VDP attr word: palette<<13 | flip | tile);
                 tiles may be relative to a tile base A5 (see emitter)
w1: Xoff        (signed offset added to the object's base X)
w2: Yoff        (signed offset added to the object's base Y)
w3: size<<8 | 0 (high byte = VDP size nibble hcells/vcells; link filled by emitter)
```

Verified against `$7f00`'s SAT (base X = `$c8`):

```
descriptor            -> SAT
2016 0050 0000 0d00   -> attr $2016, X $c8+$50=$118, size $0d   ✓
200e 0030 0000 0d00   -> attr $200e, X $c8+$30=$f8,  size $0d   ✓
2006 0010 0000 0500   -> attr $2006, X $c8+$10=$d8,  size $05?  ✓
```

## Emitter (sub-CPU overlay, PRG-RAM `$ee14` loop)

Disassembled from a live overlay dump with blastem's `dis`. Per sprite it reads 4
words from `(A3)+` (the descriptor list) and writes a 4-word SAT record via `(A1)+`:

```
SAT.Y     = basePos - (((basePos asr#5) & 24) + 8)  + D5.hi   ; D3 bit1 negates Yoff
SAT.szlnk = basePos + D7                                       ; size in high byte
SAT.attr  = descriptorTile + A5(tileBase) | D4(pal/pri)        ; palette also merged
                                                                ; from object (22,A0)&3
SAT.X     = basePos +/- Xoff                                   ; D3 bit0 negates Xoff
```

Registers: `A3` = descriptor list, `A1` = SAT out, `A5` = tile base, `D4` = attribute
bits, `D5/D7` = position accumulators, `A0` = object struct (byte `+22` = palette/flags).

## Remaining to render a scene's sprites from disc

1. Pin the scene's descriptor list in `DATA_D2` (tile-relative → match by inverting the
   SAT with the scene's tile base A5).
2. Port the emitter math above to TypeScript (feeds `Screen.drawSprite`).
3. Recover the per-scene constants (tile base A5, base X/Y, palette line) — disc-sourced
   scene layout, same category as the existing nametable origins.

Tiles (step above) and the compositor (`Screen.drawSprite`) are already done.
