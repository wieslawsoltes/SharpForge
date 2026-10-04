/**
 * Pins Roslyn's semantic-model answers for the programs of ../programs.js (SF-A02-T38).
 *
 *   node packages/compiler/test/semantic-model/tools/pin.mjs [--dotnet <path>] [--scratch <dir>]
 *
 * Builds tools/Program.cs + tools/query.csproj in a scratch directory (default node_modules/.sf/semantic-model/pin),
 * runs every program through Roslyn's SemanticModel and rewrites ../pinned.json. Needs a .NET SDK; the test never
 * does. A program that Roslyn does not compile without errors is refused: the pins describe valid programs.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { programs } from '../programs.js';
import { programHash } from '../store.js';

const tools = dirname(fileURLToPath(import.meta.url)),
  args = process.argv.slice(2),
  option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null),
  home = join(homedir(), '.dotnet', 'dotnet'),
  dotnet = option('--dotnet') ?? process.env.DOTNET ?? (existsSync(home) ? home : 'dotnet'),
  scratch = resolve(option('--scratch') ?? 'node_modules/.sf/semantic-model/pin');

mkdirSync(scratch, { recursive: true });
for (const name of ['Program.cs', 'query.csproj']) copyFileSync(join(tools, name), join(scratch, name));
const input = join(scratch, 'input.json'),
  output = join(scratch, 'output.json');
writeFileSync(input, JSON.stringify(programs.map(p => ({ id: p.id, langVersion: p.langVersion ?? null, source: p.source }))));
const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' };
execFileSync(dotnet, ['build', join(scratch, 'query.csproj'), '-c', 'Release', '-o', join(scratch, 'out'), '--nologo', '-v', 'q'], { stdio: 'inherit', env });
execFileSync(dotnet, [join(scratch, 'out', 'query.dll'), input, output], { stdio: 'inherit', env });

const document = JSON.parse(readFileSync(output, 'utf8')),
  lines = [];
for (const program of programs) {
  const result = document.results[program.id];
  if (!result) throw new Error(`${program.id}: no result`);
  if (result.errors?.length) throw new Error(`${program.id}: Roslyn reports ${result.errors.join(' ')}`);
  const rows = kind => result[kind].map(row => '\n    ' + JSON.stringify(row)).join(',');
  const head = `  ${JSON.stringify(program.id)}:{"hash":${JSON.stringify(programHash(program))}`;
  lines.push(`${head},"expressions":[${rows('expressions')}\n  ],"declarations":[${rows('declarations')}\n  ]}`);
}
const meta = { version: document.roslyn, informationalVersion: document.informationalVersion, references: document.references };
const shape =
  'expressions: [start, length, syntaxKind, symbolKind, methodKind, symbolName, symbolDisplay, type, convertedType, [constant]|null]; ' +
  'declarations: [start, length, syntaxKind, symbolKind, symbolName, symbolDisplay]';
const text = `{"roslyn":${JSON.stringify(meta)},"shape":${JSON.stringify(shape)},"programs":{\n${lines.join(',\n')}\n}}\n`;
writeFileSync(join(tools, '..', 'pinned.json'), text);
console.log(`Pinned ${programs.length} programs against Roslyn ${document.roslyn} (${document.informationalVersion}).`);
