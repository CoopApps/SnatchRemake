// Konami LZSS decompressor — the port's own copy, so decoding disc assets needs
// nothing outside port/game. Algorithm assembly-verified in MAINCPU_IP/SUBCODE;
// control byte tested LSB-first (bit 0 = literal; bit 1 = token).

export function decompressLzss(data: Uint8Array, offset: number, maxOutput = 0x40000): Uint8Array {
  const out: number[] = [];
  let pos = offset;
  const n = data.length;
  while (pos < n) {
    const control = data[pos++];
    for (let b = 0; b < 8; b++) {
      if (((control >> b) & 1) === 0) {
        if (pos >= n) return Uint8Array.from(out);
        out.push(data[pos++]);
      } else {
        if (pos >= n) return Uint8Array.from(out);
        const d0 = data[pos++];
        if (d0 === 0x1f) return Uint8Array.from(out);           // end
        if (d0 < 0x80) {                                        // long back-ref
          const fresh = data[pos++];
          const count = (d0 & 0x1f) + 3;
          const dist = (((d0 >> 5) & 3) << 8) | fresh;
          if (dist === 0 || dist > out.length) return Uint8Array.from(out);
          for (let k = 0; k < count; k++) out.push(out[out.length - dist]);
        } else if (d0 >= 0xc0) {                                // literal run
          const count = d0 - 0xb9 + 1;
          for (let k = 0; k < count && pos < n; k++) out.push(data[pos++]);
        } else {                                                // short back-ref
          const count = (d0 >> 4) - 7 + 1;
          const dist = d0 & 0x0f;
          if (dist === 0 || dist > out.length) return Uint8Array.from(out);
          for (let k = 0; k < count; k++) out.push(out[out.length - dist]);
        }
      }
      if (out.length >= maxOutput) return Uint8Array.from(out);
    }
  }
  return Uint8Array.from(out);
}
