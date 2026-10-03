/** Capture real Roslyn diagnostics: node packages/compiler/test/feature-reconciliation/capture.mjs [dotnet path]. */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'sharpforge-feature-reference-'));
const dotnet = process.argv[2] ?? 'dotnet';
const rows = [];
for (const modifier of ['readonly', 'ref', 'readonly ref']) {
  for (const langVersion of ['7', '7.2']) rows.push({ source: `${modifier} struct S {}`, langVersion, outputKind: 'library' });
}
for (const langVersion of ['8', '9']) rows.push({ source: 'int x = 1; struct S {}', langVersion, outputKind: 'exe' });
for (const langVersion of ['2', '3']) {
  rows.push({ source: 'class P { static void Main() { var x = 1; } }', langVersion, outputKind: 'exe' });
}
try {
  copyFileSync(join(directory, 'Program.cs'), join(scratch, 'Program.cs'));
  copyFileSync(new URL('../differential/tools/pin.csproj', import.meta.url), join(scratch, 'pin.csproj'));
  writeFileSync(join(scratch, 'input.json'), JSON.stringify(rows));
  const run = args => execFileSync(dotnet, args, { cwd: scratch, stdio: 'inherit' });
  run(['build', 'pin.csproj', '-c', 'Release', '-o', 'out', '--nologo', '-v', 'q']);
  run(['out/pin.dll', 'input.json', 'output.json']);
  writeFileSync(join(directory, 'roslyn.json'), readFileSync(join(scratch, 'output.json')));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
