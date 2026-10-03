/**
 * Builds the reference-manager fixture assemblies with Roslyn and pins Roslyn's diagnostics for every scenario
 * (SF-A02-T22).
 *
 *   node packages/compiler/test/references/tools/generate.mjs [--dotnet <path>] [--scratch <dir>] [--list]
 *
 * Builds tools/Program.cs in a scratch directory (default node_modules/.sf/references), rewrites
 * ../assemblies/*.dll and ../pinned.json. Needs a .NET SDK; the test run only reads the checked-in files.
 * Builds are deterministic, so regenerating with the same SDK changes nothing.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { assemblies, scenarios } from '../fixtures.js';

const tools = dirname(fileURLToPath(import.meta.url)),
  root = dirname(tools),
  repository = resolve(root, '../../../..'),
  metadata = join(repository, 'tests/fixtures/metadata');
const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const home = join(homedir(), '.dotnet', 'dotnet');
const dotnet = option('--dotnet') ?? process.env.DOTNET ?? (existsSync(home) ? home : 'dotnet');
const scratch = resolve(option('--scratch') ?? 'node_modules/.sf/references');
const assemblyDirectory = join(root, 'assemblies');

mkdirSync(scratch, { recursive: true });
for (const name of ['Program.cs', 'references.csproj']) copyFileSync(join(tools, name), join(scratch, name));
const input = join(scratch, 'input.json'),
  output = join(scratch, 'output.json');
const normalized = scenarios.map(scenario => ({
  ...scenario,
  references: scenario.references.map(reference => (typeof reference === 'string' ? { file: reference } : reference)),
}));
writeFileSync(
  input,
  JSON.stringify({
    core: join(metadata, 'MiniStandard.dll'),
    keyFile: join(metadata, 'src', 'fixtures-public.snk'),
    assemblyDirectory,
    assemblies,
    scenarios: normalized,
  }),
);
const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' };
rmSync(assemblyDirectory, { recursive: true, force: true });
execFileSync(dotnet, ['build', join(scratch, 'references.csproj'), '-c', 'Release', '-o', join(scratch, 'out'), '--nologo', '-v', 'q'], {
  stdio: 'inherit',
  env,
});
execFileSync(dotnet, [join(scratch, 'out', 'references.dll'), input, output], { stdio: 'inherit', env });

const document = JSON.parse(readFileSync(output, 'utf8'));
const lines = scenarios.map(scenario => {
  const rows = document.results[scenario.id];
  if (!rows) throw new Error(`${scenario.id}: no result`);
  if (args.includes('--list')) console.log(scenario.id.padEnd(44), rows.map(row => `${row[0]}@${row[1]}+${row[2]}`).join(' ') || '-');
  const body = rows.map(row => '\n      ' + JSON.stringify(row)).join(',');
  return `    ${JSON.stringify(scenario.id)}: [${body}${rows.length ? '\n    ' : ''}]`;
});
const text =
  '{\n' +
  `  "roslyn": ${JSON.stringify(document.roslyn)},\n` +
  `  "informationalVersion": ${JSON.stringify(document.informationalVersion)},\n` +
  '  "options": "OutputKind.ConsoleApplication, LanguageVersion.Latest, core library MiniStandard.dll only",\n' +
  `  "assemblies": ${JSON.stringify(document.assemblies, null, 2).replace(/\n/g, '\n  ')},\n` +
  '  "results": {\n' +
  lines.join(',\n') +
  '\n  }\n}\n';
JSON.parse(text);
writeFileSync(join(root, 'pinned.json'), text);
console.log(`Pinned ${scenarios.length} scenarios and ${Object.keys(document.assemblies).length} assemblies against Roslyn ${document.roslyn}.`);
