#!/usr/bin/env node
/**
 * Regenerates pinned.json, the Roslyn classification of every pair of the conversion corpus (SF-A02-T06.1).
 *
 *   node packages/compiler/test/conversions/generate-roslyn-conversions.js [--dotnet <path>] [--scratch <dir>]
 *
 * Builds tools/Program.cs + tools/classify.csproj in a scratch directory (default
 * node_modules/.sf/conversions/classify) against the Roslyn that ships with the .NET SDK and runs it over the corpus.
 * Needs a .NET SDK (`--dotnet`, the DOTNET environment variable, ~/.dotnet/dotnet or `dotnet` on PATH); the test run
 * itself never does. Each pinned row is `[source, target, kind, exists, isImplicit, isExplicit]`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadCorpus, corpusHash, pairCount, pinnedPath } from './corpus.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const homeDotnet = join(homedir(), '.dotnet', 'dotnet');
const dotnet = option('--dotnet') ?? process.env.DOTNET ?? (existsSync(homeDotnet) ? homeDotnet : 'dotnet');
const scratch = resolve(option('--scratch') ?? 'node_modules/.sf/conversions/classify');

const corpus = loadCorpus();
mkdirSync(scratch, { recursive: true });
for (const name of ['Program.cs', 'classify.csproj']) copyFileSync(join(here, 'tools', name), join(scratch, name));
const inputPath = join(scratch, 'input.json');
const outputPath = join(scratch, 'output.json');
const input = corpus.map(unit => ({
  langVersion: unit.langVersion,
  source: unit.source,
  typePairs: unit.typePairs.map(row => [row.from, row.to]),
  expressionTargets: unit.expressions.map(row => row.to),
}));
writeFileSync(inputPath, JSON.stringify(input));

const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' };
const buildArguments = ['build', join(scratch, 'classify.csproj'), '-c', 'Release', '-o', join(scratch, 'out'), '--nologo', '-v', 'q'];
execFileSync(dotnet, buildArguments, { stdio: 'inherit', env });
execFileSync(dotnet, [join(scratch, 'out', 'classify.dll'), inputPath, outputPath], { stdio: 'inherit', env });

const result = JSON.parse(readFileSync(outputPath, 'utf8'));
const row = (pair, classified) => JSON.stringify([pair.source, pair.target, ...classified]);
const sections = corpus.map((unit, index) => {
  const classified = result.compilations[index];
  const typeRows = unit.typePairs.map((pair, at) => row(pair, classified.typePairs[at]));
  const expressionRows = unit.expressions.map((pair, at) => row(pair, classified.expressions[at]));
  return [
    ` {"langVersion":${JSON.stringify(classified.langVersion)},`,
    `  "typePairs":[\n   ${typeRows.join(',\n   ')}\n  ],`,
    `  "expressions":[${expressionRows.length ? `\n   ${expressionRows.join(',\n   ')}\n  ` : ''}]}`,
  ].join('\n');
});
const header = {
  roslyn: result.roslyn,
  informationalVersion: result.informationalVersion,
  hash: corpusHash(corpus),
  shape: 'rows are [source, target, Roslyn ConversionKind, exists, isImplicit, isExplicit]',
};
writeFileSync(pinnedPath, `{${JSON.stringify(header).slice(1, -1)},\n"compilations":[\n${sections.join(',\n')}\n]}\n`);
console.log(`Pinned ${pairCount(corpus)} conversion pairs against Roslyn ${result.roslyn}.`);
