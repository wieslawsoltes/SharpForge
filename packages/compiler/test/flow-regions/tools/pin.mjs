/**
 * Pins Roslyn's region analysis for the programs of ../regions.js (SF-A02-T35).
 *
 *   node packages/compiler/test/flow-regions/tools/pin.mjs [--dotnet <path>] [--scratch <dir>] [--list]
 *
 * Builds tools/Program.cs + tools/regions.csproj in a scratch directory (default node_modules/.sf/flow-regions/pin),
 * asks Roslyn's SemanticModel.AnalyzeDataFlow / AnalyzeControlFlow about every marked region and rewrites
 * ../pinned.json. Needs a .NET SDK; the test never does. A program Roslyn does not compile without errors is refused,
 * except for the diagnostics a region about unreachable code is expected to have (none are errors).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { regions } from '../regions.js';
import { regionHash, resultKeys } from '../store.js';

const tools = dirname(fileURLToPath(import.meta.url)),
  args = process.argv.slice(2),
  option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null),
  home = join(homedir(), '.dotnet', 'dotnet'),
  dotnet = option('--dotnet') ?? process.env.DOTNET ?? (existsSync(home) ? home : 'dotnet'),
  scratch = resolve(option('--scratch') ?? 'node_modules/.sf/flow-regions/pin');

mkdirSync(scratch, { recursive: true });
for (const name of ['Program.cs', 'regions.csproj']) copyFileSync(join(tools, name), join(scratch, name));
const input = join(scratch, 'input.json'),
  output = join(scratch, 'output.json');
writeFileSync(input, JSON.stringify(regions.map(region => ({ id: region.id, source: region.source }))));
const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' };
execFileSync(dotnet, ['build', join(scratch, 'regions.csproj'), '-c', 'Release', '-o', join(scratch, 'out'), '--nologo', '-v', 'q'], { stdio: 'inherit', env });
execFileSync(dotnet, [join(scratch, 'out', 'regions.dll'), input, output], { stdio: 'inherit', env });

const document = JSON.parse(readFileSync(output, 'utf8')),
  lines = [];
for (const region of regions) {
  const result = document.results[region.id];
  if (!result) throw new Error(`${region.id}: no result`);
  if (result.errors.length) throw new Error(`${region.id}: Roslyn reports ${result.errors.join(' ')}`);
  const pinned = { hash: regionHash(region), region: result.region };
  for (const key of resultKeys) pinned[key] = result[key];
  lines.push(`  ${JSON.stringify(region.id)}:${JSON.stringify(pinned)}`);
  if (args.includes('--list')) console.log(region.id.padEnd(40), JSON.stringify(Object.fromEntries(resultKeys.map(key => [key, result[key]]))));
}
const meta = { version: document.roslyn, informationalVersion: document.informationalVersion, references: document.references };
const shape = 'region: [start, end] of the statements analysed; variable sets are sorted names; returnStatements, exitPoints and entryPoints are counts';
writeFileSync(join(tools, '..', 'pinned.json'), `{"roslyn":${JSON.stringify(meta)},"shape":${JSON.stringify(shape)},"regions":{\n${lines.join(',\n')}\n}}\n`);
console.log(`Pinned ${regions.length} regions against Roslyn ${document.roslyn} (${document.informationalVersion}).`);
