/**
 * Regenerates the pinned Roslyn reference data next to the syntax fixtures:
 *   node packages/syntax/tools/update-reference.js
 * Requires the .NET SDK. The tool compiles against the Roslyn assemblies inside that SDK, so the Roslyn version and
 * commit recorded in every dump ("roslyn" field) are those of the installed SDK; output is byte-identical for one SDK.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, basename } from 'node:path';
import { previewRevisions } from '../src/preview-revisions.js';
const tool = fileURLToPath(new URL('./roslyn-tree-export', import.meta.url)), fixtures = fileURLToPath(new URL('../test', import.meta.url));
const run = args => { const result = spawnSync('dotnet', args, { stdio: 'inherit' }); if (result.status !== 0) { console.error('dotnet ' + args.join(' ') + ' failed'); process.exit(result.status ?? 1); } };
run(['build', tool, '-c', 'Release', '-v', 'q', '--nologo']);
const dll = resolve(tool, 'bin/Release/net10.0/roslyn-tree-export.dll');
for (const directory of ['reference', 'lexer-corpus', 'expression-corpus', 'matrix']) run([dll, resolve(fixtures, directory), resolve(fixtures, directory)]);
run([dll, '--features', resolve(fixtures, 'reference/roslyn-features.json')]);
// Only the positive matrix fixtures are compared with Roslyn trees; rejected fixtures are checked by the feature gate, and
// preview features the pinned Roslyn build does not parse (stamp.roslyn false) have no reference tree at all.
const prune = directory => { for (const entry of readdirSync(directory, { withFileTypes: true })) { const path = resolve(directory, entry.name); if (entry.isDirectory()) prune(path); else if (entry.name === 'rejected.cs.json' || entry.name === 'positive.cs.json' && previewRevisions[basename(directory)]?.roslyn === false) rmSync(path); } };
prune(resolve(fixtures, 'matrix'));
