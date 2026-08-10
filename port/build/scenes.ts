// Per-scene disc-sourcing manifests (BUILD-TIME ONLY).
// This is where all disc offsets/filenames live now — the port/game/ side
// never sees them. Adding a scene = adding an entry here + a matching
// entry in the layout extractor list.
//
// Every entry is provenance the port carries as source data: which disc file,
// which offset, how big, and (for LZSS blocks with header) any prefix to skip.

export interface TileBlockSpec {
  file: string;        // disc filename in extracted/
  offset: number;      // byte offset in the disc file (where decode should START)
  compression: 'lzss'; // (only lzss so far; future: 'raw')
  sizePrefix?: boolean;// true if there's a u16 size word BEFORE offset (skip 2 bytes into stream)
  headerSkip?: number; // bytes to skip after decompression (e.g. RSS's 601-byte prefix)
  name?: string;       // for multi-block scenes: block name in the layout JSON
  loadTileBase?: number; // VRAM tile index this block loads to (multi-block plane-A
                         // scenes; block 1 defaults to nametable.loadTileBase)
}

export interface PaletteBlockSpec {
  file: string;
  offset: number;      // Genesis 0BGR word bytes, byte-exact (line 0, or all if contiguous)
  lines: number;       // number of 16-word palette lines to export (1..4)
  lineOffsets?: number[]; // per-line offsets when lines aren't contiguous on disc
}

export interface AnimTableSpec {
  key: string;         // name in the exported engine_tables.json
  file: string;
  offset: number;
  wordCount: number;   // 16-bit big-endian words
}

export interface NametableSpec {
  file: string;
  offset: number;
  compression: 'lzss' | 'raw';
  sizePrefix?: boolean;       // for lzss: true = u16 BE size before block
  loadTileBase: number;       // first VRAM tile the tile-block loads to
  planeCols?: number;         // default 32
  planeRows?: number;         // default 28 (visible area)
}

export interface PlaneBSpec {
  tiles: TileBlockSpec[];
  nametable: NametableSpec;
}

export interface SceneSpec {
  id: string;
  tiles: TileBlockSpec[];    // plane A tiles (one or more blocks)
  palette: PaletteBlockSpec;
  nametable?: NametableSpec; // plane A nametable (disc-sourced)
  planeB?: PlaneBSpec;       // optional plane B background layer
  engineTables?: AnimTableSpec[]; // Konami's palette blocks the engine reads
}

export const SCENES: SceneSpec[] = [
  {
    id: 'konami_logo',
    // NOTE Konami's block at $15A0 has NO 2-byte size prefix (starts directly
    // with the LZSS control byte). Its size is in $159E (u16) but the decoder
    // doesn't need it — end marker terminates.
    tiles: [{ file: 'MAINCPU_IP.BIN', offset: 0x15a0, compression: 'lzss' }],
    palette: { file: 'MAINCPU_IP.BIN', offset: 0x14be, lines: 4 },
    // These are the palette-animation tables the KonamiSequence engine reads
    // per phase (blue base, reveal blocks, gold gradients, silver fill, shimmer cycle).
    engineTables: [
      { key: 'blue_base',    file: 'MAINCPU_IP.BIN', offset: 0x153e, wordCount: 16 },
      { key: 'lines12_block',file: 'MAINCPU_IP.BIN', offset: 0x14de, wordCount: 32 },
      { key: 'line0_block',  file: 'MAINCPU_IP.BIN', offset: 0x14be, wordCount: 16 },
      { key: 'line0_fill',   file: 'MAINCPU_IP.BIN', offset: 0x14ca, wordCount: 24 }, // 0x30 bytes slid in
      { key: 'line1_fill',   file: 'MAINCPU_IP.BIN', offset: 0x14ea, wordCount: 24 },
      { key: 'line2_fill',   file: 'MAINCPU_IP.BIN', offset: 0x150a, wordCount: 24 },
      { key: 'bar_cycle',    file: 'MAINCPU_IP.BIN', offset: 0x2892, wordCount: 2  }, // 4 bytes = 2 words
    ],
  },
  {
    id: 'title',
    tiles: [
      { name: 'A', file: 'DATA_D2.BIN', offset: 0x19ee, compression: 'lzss', sizePrefix: true },
      { name: 'B', file: 'DATA_D2.BIN', offset: 0x3164, compression: 'lzss', sizePrefix: true },
      { name: 'C', file: 'DATA_D2.BIN', offset: 0x4a70, compression: 'lzss', sizePrefix: true },
      { name: 'D', file: 'DATA_D2.BIN', offset: 0x667c, compression: 'lzss', sizePrefix: true },
      { name: 'E', file: 'DATA_D2.BIN', offset: 0x6afe, compression: 'lzss', sizePrefix: true },
      { name: 'F', file: 'DATA_D2.BIN', offset: 0x81f8, compression: 'lzss', sizePrefix: true },
    ],
    palette: { file: 'DATA_D2.BIN', offset: 0x13184, lines: 4 },
  },
  {
    id: 'disclaimer',
    tiles: [{ file: 'DATA_D1.BIN', offset: 0xada6, compression: 'lzss', sizePrefix: true }],
    palette: { file: 'DATA_D1.BIN', offset: 0x1fe82, lines: 1 },
  },
  {
    id: 'rss',
    tiles: [{ file: 'DATA_D1.BIN', offset: 0xc31c, compression: 'lzss', sizePrefix: true, headerSkip: 601 }],
    palette: { file: 'DATA_D1.BIN', offset: 0x1fec2, lines: 1 },
  },
  {
    // Neo Kobe Times newspaper. Two LZSS blocks: base image (256 tiles at
    // $200) + article/text tiles (107 at $300, verified 107/107 byte-exact
    // via hunt_missing.ts). Full plane-A coverage.
    id: 'neokobe_news',
    tiles: [
      { file: 'DATA_D1.BIN', offset: 0x310a, compression: 'lzss', sizePrefix: true },
      { file: 'DATA_D1.BIN', offset: 0x4116, compression: 'lzss', sizePrefix: true, loadTileBase: 0x300 },
    ],
    palette: { file: 'DATA_D1.BIN', offset: 0x1dd02, lines: 4 },
    nametable: { file: 'DATA_D1.BIN', offset: 0x20526, compression: 'lzss', sizePrefix: true, loadTileBase: 0x200 },
  },
  {
    // Cyborg wireframe body diagram. Two LZSS blocks: base wireframe (256
    // tiles at $200) + labels/panel tiles (134 at $300, verified 134/134
    // byte-exact via hunt_missing.ts). Full plane-A coverage.
    id: 'wireframe_body',
    tiles: [
      { file: 'DATA_D1.BIN', offset: 0x7cb0, compression: 'lzss', sizePrefix: true },
      { file: 'DATA_D1.BIN', offset: 0x8e78, compression: 'lzss', sizePrefix: true, loadTileBase: 0x300 },
    ],
    palette: { file: 'DATA_D1.BIN', offset: 0x1de02, lines: 4 },
    nametable: { file: 'DATA_D1.BIN', offset: 0x210fa, compression: 'lzss', sizePrefix: true, loadTileBase: 0x200 },
  },
  {
    // Character portrait — Katrina. Full plane-A coverage from a single LZSS
    // block that Snatcher shares between the two portraits (Katrina + Gillian
    // reuse the same tile art with different palette lines).
    id: 'portrait_katrina',
    tiles: [{ file: 'DATA_D0.BIN', offset: 0x21c6c, compression: 'lzss', sizePrefix: true }],
    palette: { file: 'DATA_D0.BIN', offset: 0x37660, lines: 4 },
    nametable: { file: 'DATA_D0.BIN', offset: 0x3b356, compression: 'lzss', sizePrefix: true, loadTileBase: 0x400 },
    planeB: {
      tiles: [{ name: 'B', file: 'DATA_D0.BIN', offset: 0x215e6, compression: 'lzss', sizePrefix: true }],
      nametable: { file: 'DATA_D0.BIN', offset: 0x3b152, compression: 'lzss', sizePrefix: true, loadTileBase: 0x300 },
    },
  },
  {
    // Character portrait — Gillian Seed. Same tile block as Katrina above;
    // differs by palette line only.
    id: 'portrait_gillian',
    tiles: [{ file: 'DATA_D0.BIN', offset: 0x21c6c, compression: 'lzss', sizePrefix: true }],
    // Lines are NOT contiguous on disc — each pinned individually by matching
    // the CRAM state at f23760 (hunt_all3.ts §3).
    palette: { file: 'DATA_D0.BIN', offset: 0x377c0, lines: 4,
               lineOffsets: [0x377c0, 0x37680, 0x379c0, 0x37bc0] },
    nametable: { file: 'DATA_D0.BIN', offset: 0x3b356, compression: 'lzss', sizePrefix: true, loadTileBase: 0x400 },
    planeB: {
      tiles: [{ name: 'B', file: 'DATA_D0.BIN', offset: 0x215e6, compression: 'lzss', sizePrefix: true }],
      nametable: { file: 'DATA_D0.BIN', offset: 0x3b152, compression: 'lzss', sizePrefix: true, loadTileBase: 0x300 },
    },
  },
  {
    // Dedication text — "THIS STORY IS DEDICATED TO ALL THOSE CYBERPUNKS...".
    // NOT dynamically composed after all: the full text screen is a pre-baked
    // LZSS tile bank on disc. (Earlier "dynamic text engine" conclusion was
    // wrong — Word RAM $239xxx was just the Sub-CPU's decompression staging
    // buffer before DMA.) 210/210 used tiles verified byte-exact.
    id: 'dedication',
    tiles: [{ file: 'DATA_D1.BIN', offset: 0xb0ca, compression: 'lzss', sizePrefix: true }],
    palette: { file: 'DATA_D1.BIN', offset: 0x1fe82, lines: 1 },
    nametable: { file: 'DATA_D1.BIN', offset: 0x21bd6, compression: 'lzss', sizePrefix: true, loadTileBase: 0x0 },
  },
  {
    // Moscow chapter title ("Moscow: June 6, 1996"). Block-1 covers 255/312
    // plane-A tiles; the serif date text tiles are the remainder (block-2 not
    // yet pinned — renders with gaps until found). NT pinned via 3-probe-row
    // method (hunt_all3.ts §2a).
    id: 'moscow_title',
    tiles: [{ file: 'DATA_D1.BIN', offset: 0x19a8, compression: 'lzss', sizePrefix: true }],
    palette: { file: 'DATA_D1.BIN', offset: 0x1dce2, lines: 1 },
    nametable: { file: 'DATA_D1.BIN', offset: 0x2016e, compression: 'lzss', sizePrefix: true, loadTileBase: 0x0 },
  },
  {
    // Map of Japan with red hotspots. Plane A (59 tiles) is the small inset;
    // plane B (176 tiles) is the big red map — both disc-verified byte-exact.
    id: 'japan_map',
    tiles: [{ file: 'DATA_A0.BIN', offset: 0x7f96, compression: 'lzss', sizePrefix: true, loadTileBase: 0x200 }],
    palette: { file: 'DATA_D0.BIN', offset: 0x37440, lines: 4 },
    nametable: { file: 'DATA_D0.BIN', offset: 0x3acd8, compression: 'lzss', sizePrefix: true, loadTileBase: 0x200 },
    planeB: {
      tiles: [{ name: 'B', file: 'DATA_D0.BIN', offset: 0x20df8, compression: 'lzss', sizePrefix: true, loadTileBase: 0x2ed }],
      nametable: { file: 'DATA_D0.BIN', offset: 0x3af1e, compression: 'lzss', sizePrefix: true, loadTileBase: 0x2ed },
    },
  },
  {
    // Production credits on magenta stripes. Plane A = 151 tiles (2 blocks);
    // plane B = the magenta stripe backdrop (637 tiles, 3 blocks). Credit
    // NAMES ride sprites (code-placed) — the remaining delta.
    id: 'prod_credits',
    tiles: [
      { file: 'DATA_D0.BIN', offset: 0x1ad5c, compression: 'lzss', sizePrefix: true, loadTileBase: 0x180 },
      { name: 'A2', file: 'DATA_D0.BIN', offset: 0x1bc78, compression: 'lzss', sizePrefix: true, loadTileBase: 0x500 },
    ],
    palette: { file: 'DATA_D0.BIN', offset: 0x371a0, lines: 4 },
    nametable: { file: 'DATA_D0.BIN', offset: 0x3a446, compression: 'lzss', sizePrefix: true, loadTileBase: 0x180 },
    planeB: {
      tiles: [
        { name: 'B', file: 'DATA_D0.BIN', offset: 0x18278, compression: 'lzss', sizePrefix: true, loadTileBase: 0x200 },
        { name: 'B2', file: 'DATA_D0.BIN', offset: 0x192f8, compression: 'lzss', sizePrefix: true, loadTileBase: 0x300 },
        { name: 'B3', file: 'DATA_D0.BIN', offset: 0x1a432, compression: 'lzss', sizePrefix: true, loadTileBase: 0x400 },
      ],
      nametable: { file: 'DATA_D0.BIN', offset: 0x39a30, compression: 'lzss', sizePrefix: true, loadTileBase: 0x200 },
    },
  },
  {
    // Neon street with SEISHIN sign (Neo Kobe back-alley). Plane A is the
    // full detailed foreground — 813 tiles across 4 chained LZSS blocks
    // (all verified byte-exact via hunt_full.ts). Plane B (sky/backdrop,
    // 814 tiles) not yet added.
    id: 'street_ident',
    tiles: [
      { file: 'DATA_D0.BIN', offset: 0x113b6, compression: 'lzss', sizePrefix: true },
      { name: 'A2', file: 'DATA_D0.BIN', offset: 0x1261e, compression: 'lzss', sizePrefix: true, loadTileBase: 0x400 },
      { name: 'A3', file: 'DATA_D0.BIN', offset: 0x13ba0, compression: 'lzss', sizePrefix: true, loadTileBase: 0x500 },
      { name: 'A4', file: 'DATA_D0.BIN', offset: 0x150fa, compression: 'lzss', sizePrefix: true, loadTileBase: 0x600 },
    ],
    palette: { file: 'DATA_D0.BIN', offset: 0x37080, lines: 4 },
    nametable: { file: 'DATA_D0.BIN', offset: 0x3935a, compression: 'lzss', sizePrefix: true, loadTileBase: 0x300 },
  },
  {
    // Neo Kobe skyline with staff credits. Two tile blocks (171/171 missing
    // verified in block-2); plane-A NT via 3-probe-row method. The credit
    // TEXT rides plane A; the scrolling skyline is plane B (tiles not yet
    // pinned — plane B omitted until found).
    id: 'city_credits',
    tiles: [
      { file: 'DATA_D0.BIN', offset: 0xdcba, compression: 'lzss', sizePrefix: true },
      { file: 'DATA_D0.BIN', offset: 0xedfc, compression: 'lzss', sizePrefix: true, loadTileBase: 0x450 },
    ],
    palette: { file: 'DATA_D0.BIN', offset: 0x36f60, lines: 4 },
    nametable: { file: 'DATA_D0.BIN', offset: 0x38fd6, compression: 'lzss', sizePrefix: true, loadTileBase: 0x500 },
    planeB: {
      // Skyline: three chained $2000 blocks (664/664 verified byte-exact).
      tiles: [
        { file: 'DATA_D0.BIN', offset: 0xaa02, compression: 'lzss', sizePrefix: true, loadTileBase: 0x1b0 },
        { file: 'DATA_D0.BIN', offset: 0xbadc, compression: 'lzss', sizePrefix: true, loadTileBase: 0x2b0 },
        { file: 'DATA_D0.BIN', offset: 0xcf7e, compression: 'lzss', sizePrefix: true, loadTileBase: 0x3b0 },
      ],
      nametable: { file: 'DATA_D0.BIN', offset: 0x386ac, compression: 'lzss', sizePrefix: true, loadTileBase: 0x1b0 },
    },
  },
  {
    // The gold SNATCHER title reveal — full plane-A coverage from two LZSS
    // blocks (242/242 missing tiles verified in block-2 via hunt_all3.ts §2b).
    id: 'title_reveal',
    tiles: [
      { file: 'DATA_D0.BIN', offset: 0x2a70, compression: 'lzss', sizePrefix: true },
      { file: 'DATA_D0.BIN', offset: 0x360a, compression: 'lzss', sizePrefix: true, loadTileBase: 0x400 },
    ],
    palette: { file: 'DATA_D0.BIN', offset: 0x36840, lines: 4 },
    nametable: { file: 'DATA_D0.BIN', offset: 0x37ea0, compression: 'lzss', sizePrefix: true, loadTileBase: 0x300 },
  },
  {
    // JUNKER database screen (bio-cells + character menu) — first true-ported
    // scene after the snapshot demolition. All three assets located on disc by
    // matching against reference at f6560 (see port/build/hunt_subway.ts /
    // pin_subway.ts). Tiles are a BE-word stream after LZSS decode; tile block
    // loads to VRAM tile $500. Nametable is a separate LZSS block. All 158
    // used plane-A tiles verified byte-exact. Plane B + sprites not yet
    // sourced — that's the remaining ~18% delta at 82.4% fidelity.
    id: 'junker_db',
    tiles: [{ file: 'DATA_D1.BIN', offset: 0x143e, compression: 'lzss', sizePrefix: true }],
    palette: { file: 'DATA_D1.BIN', offset: 0x1d822, lines: 4 },
    nametable: { file: 'DATA_D1.BIN', offset: 0x1ff62, compression: 'lzss', sizePrefix: true, loadTileBase: 0x500 },
  },
];
