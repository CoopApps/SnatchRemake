// PreToolUse hook: block Write/Edit into port/game/ that adds hard-coded
// animation constants (hex literals, byte arrays) without cited disc
// provenance. Enforces the "no inventions" rule structurally so I cannot
// drift into eyeballing values from the reference.
//
// Input: JSON on stdin (Claude Code PreToolUse payload).
// Exit 0 = allow. Exit non-zero + stderr message = block, message shown to me.
//
// Provenance rules — an added constant is authentic if the SAME edit also
// contains one of:
//   • a disc-file mention (e.g. "MAINCPU_IP.BIN", "SUBCODE.BIN", any *.BIN)
//   • a disc-offset comment ("// FROM $XXXX", "disc $XXXX", "from $XXXX")
//   • a routine reference in a code comment ("// $XXXXXX", "FUN_XXXXXXXX")
//   • an explicit override marker "// AUTHORED-LAYOUT" or "// PLATFORM-CONST"
//     (for genuinely-not-code data like the DAC curve or an authored tilemap)
//
// This blocks the ~/BAR_ROWS=[2,2,3,4,6,...]/ shortcut and its cousins.

import fs from 'node:fs';

let raw = '';
process.stdin.on('data', c => raw += c);
process.stdin.on('end', () => {
  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }         // malformed → don't block
  const tool = payload.tool_name;
  if (tool !== 'Write' && tool !== 'Edit') process.exit(0);
  const input = payload.tool_input || {};
  const filePath = String(input.file_path || '');

  // Only gate files under port/game/. The harness and dev tools are exempt.
  if (!/[\\/]port[\\/]game[\\/]/i.test(filePath)) process.exit(0);
  // Skip generated data files.
  if (/\.(json|raw|png|gif|state|bin)$/i.test(filePath)) process.exit(0);

  // Text we're about to introduce: Write.content OR Edit.new_string (also
  // batches). We do NOT check what's being REMOVED — deletions are always fine.
  const additions = [];
  if (tool === 'Write' && typeof input.content === 'string') additions.push(input.content);
  if (tool === 'Edit' && typeof input.new_string === 'string') additions.push(input.new_string);
  if (Array.isArray(input.edits)) for (const e of input.edits) if (typeof e.new_string === 'string') additions.push(e.new_string);
  const added = additions.join('\n');
  if (!added) process.exit(0);

  // ---------- TRUE-PORT RULES (checked before magic-constants) ----------
  const trueportRules = [
    { pat: /snatcher\/extracted|\/extracted\//,                                         msg: 'reads the extracted original disc directory (port must use bundled assets only)' },
    { pat: /(?<!\/\/[^\n]{0,200})\bdiscFile\s*\(/,                                      msg: 'calls discFile() — disc-reading belongs in port/build/, not port/game/' },
    { pat: /(?<!\/\/[^\n]{0,200})\bdecompressLzss\s*\(/,                                msg: 'calls decompressLzss() — decoding belongs in port/build/, not port/game/' },
    { pat: /(MAINCPU_IP|SUBCODE|BOOT_SP|DATA_[A-Z0-9_]+)\.BIN/i,                        msg: 'names a raw disc file (bundled assets have neutral names in port/game/assets/)' },
    { pat: /from ['"][^'"]*\/build\//,                                                  msg: 'imports from port/build/ (build code must never be pulled into the runtime port)' },
  ];
  for (const r of trueportRules) {
    if (r.pat.test(added)) {
      process.stderr.write(
        `BLOCKED by no_magic_constants hook (TRUE-PORT rule).\n` +
        `File: ${filePath}\n` +
        `Reason: ${r.msg}\n\n` +
        `port/game/ is the SHIPPED PORT. It reads ONLY from port/game/assets/\n` +
        `(files produced offline by port/build/export_assets.ts). It must never\n` +
        `mention the original disc, its filenames, or its compression formats.\n` +
        `The disc-hidden proof in port/harness/run.ts must pass — rename the\n` +
        `original extracted/ folder away and the port still renders identically.\n`
      );
      process.exit(1);
    }
  }

  // Strip comments so provenance markers in comments still count, but
  // magic-number *checks* only fire on real code. Keep comments too for the
  // provenance test.
  const noBlockComments = added.replace(/\/\*[\s\S]*?\*\//g, '');
  const codeOnly = noBlockComments.split('\n').map(l => l.replace(/\/\/.*/, '')).join('\n');

  // Detect the shortcut patterns:
  //   • hex literals (0xNN, 0xNNNN, ...) in code
  //   • large decimal literals (>= 3 digits) — animation frame constants,
  //     tuned intensity values, etc. Small numbers 0–99 stay allowed (loop
  //     counters, index math).
  //   • byte-array-like sequences: [ n, n, n, n, ... ] (>=4 numeric elements)
  const hexHits    = (codeOnly.match(/\b0x[0-9a-fA-F]{2,}\b/g) || []);
  const bigDecHits = (codeOnly.match(/(?<![\w.])\d{3,}(?![\w.])/g) || []);
  const arrayHit   = /\[\s*\d+\s*(?:,\s*\d+\s*){3,}\]/.test(codeOnly);
  const numericLoad = hexHits.length + bigDecHits.length + (arrayHit ? 1 : 0);
  if (numericLoad === 0) process.exit(0);

  // Provenance markers (checked against the FULL added text incl. comments).
  const provenanceOk =
    /\b[A-Z0-9_]+\.BIN\b/i.test(added) ||                                   // disc file name
    /(?:disc|FROM|@)\s*\$?[0-9a-fA-F]{3,}/.test(added) ||                   // disc/FROM/@ $offset
    /\bFUN_[0-9a-fA-F]{6,}\b/.test(added) ||                                // ghidra routine ref
    /\/\/\s*\$[0-9a-fA-F]{3,}/.test(added) ||                               // // $XXXX line comment
    /AUTHORED-LAYOUT|PLATFORM-CONST|DISC-OFFSET/i.test(added);              // explicit override

  if (provenanceOk) process.exit(0);

  // Block. Explain clearly so the assistant knows exactly what's wrong and
  // how to make the edit acceptable.
  const summary = [
    hexHits.length ? `${hexHits.length} hex literal(s) (e.g. ${hexHits.slice(0, 3).join(', ')})` : null,
    bigDecHits.length ? `${bigDecHits.length} large-number literal(s) (e.g. ${bigDecHits.slice(0, 3).join(', ')})` : null,
    arrayHit ? 'a numeric array literal' : null,
  ].filter(Boolean).join(', ');
  process.stderr.write(
    `BLOCKED by no_magic_constants hook.\n` +
    `File: ${filePath}\n` +
    `You are adding ${summary} to port/game/ without disc provenance.\n\n` +
    `port/game/ is the CLEAN-ROOM PORT. Every animation/timing/palette constant must trace to:\n` +
    `  • a disc file (mention e.g. "MAINCPU_IP.BIN") + offset comment "// $XXXX", or\n` +
    `  • the ghidra routine you ported ("// $202846" or "FUN_00202846"), or\n` +
    `  • an explicit "// AUTHORED-LAYOUT" / "// PLATFORM-CONST" marker for\n` +
    `    genuinely non-code data (authored tilemaps, hardware DAC curve, etc.).\n\n` +
    `If you're tempted to eyeball a value from the reference render, STOP.\n` +
    `Trace it in the code first. That's the whole point of this hook.\n`
  );
  process.exit(1);
});
