// Stop-hook wrapper: runs the remake harness and surfaces its scoreboard to the
// user as a systemMessage, every turn. This is the ENFORCEMENT the user asked
// for — the harness runs whether or not the assistant remembers to.
import { execSync } from 'node:child_process';

const CWD = 'D:/completed ai projects/structural_carver/emulator';
let out;
try {
  out = execSync('npx tsx port/harness/run.ts', { cwd: CWD, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  out = `harness error:\n${(e.stdout || '') + (e.stderr || e.message || '')}`;
}
process.stdout.write(JSON.stringify({ systemMessage: out.trimEnd(), suppressOutput: true }));
