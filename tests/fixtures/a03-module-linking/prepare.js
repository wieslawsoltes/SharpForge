import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileToIL } from '@sharpforge/compiler';

const [output, betaPath] = process.argv.slice(2);
if (!output || !betaPath) throw new Error('Usage: prepare.js OUTPUT_DIRECTORY ROSLYN_BETA_NETMODULE');
mkdirSync(output, { recursive: true });
const alpha = compileToIL('public class Alpha { public static int Value() { return 42; } }',
  { name: 'Alpha', outputKind: 'netmodule', portablePdb: false });
if (!alpha.success) throw new Error(JSON.stringify(alpha.diagnostics));
const beta = new Uint8Array(readFileSync(betaPath));
const manifest = compileToIL('public class Main {}',
  { name: 'Manifest', outputKind: 'library', linkedModules: [alpha.assembly, beta], portablePdb: false });
if (!manifest.success) throw new Error(JSON.stringify(manifest.diagnostics));
writeFileSync(join(output, 'Alpha.netmodule'), alpha.assembly);
writeFileSync(join(output, 'Beta.netmodule'), beta);
writeFileSync(join(output, 'Manifest.dll'), manifest.assembly);
