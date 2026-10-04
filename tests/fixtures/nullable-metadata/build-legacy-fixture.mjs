#!/usr/bin/env node
/** Actual Roslyn output against a documented temporary reference projection lacking nullable attribute types. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateReferencePack } from '../../../packages/compiler/src/node/reference-pack.js';
import { embeddedAttributeDefinitions, nullableAttributeRows } from './inspect-metadata.mjs';
import { referenceWithoutNullable } from './reference-without-nullable.mjs';

const root = process.env.DOTNET_ROOT;
if (!root) throw new Error('Set DOTNET_ROOT to the SDK used to capture this oracle.');
const dotnet = process.env.DOTNET ?? join(root, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');
const sdk = readdirSync(join(root, 'sdk')).filter(version => existsSync(join(root, 'sdk', version, 'Roslyn', 'bincore', 'csc.dll')))
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true })).at(-1);
const compiler = sdk && join(root, 'sdk', sdk, 'Roslyn', 'bincore', 'csc.dll');
const pack = locateReferencePack();
if (!compiler || !pack) throw new Error('A Roslyn compiler and .NET reference pack are required.');
const runtime = pack.files.find(path => basename(path) === 'System.Runtime.dll');
if (!runtime) throw new Error('This fixture projects a System.Runtime-based reference pack.');
const original = readFileSync(runtime), projected = referenceWithoutNullable(original);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const scratch = mkdtempSync(join(tmpdir(), 'sharpforge-nullable-reference-'));
const here = dirname(fileURLToPath(import.meta.url)), source = join(here, 'NullableMetadata.cs');
const output = join(here, 'LegacyNullableMetadata.dll');
const options = ['-nologo', '-noconfig', '-nostdlib', '-target:library', '-deterministic', '-debug-', '-optimize+',
  '-langversion:preview', '-nullable:disable', '-unsafe', '-nowarn:CS8618,CS0067'];
try {
  const replacement = join(scratch, 'System.Runtime.dll');
  writeFileSync(replacement, projected.bytes);
  const compiled = spawnSync(dotnet, [compiler, ...options, '-out:' + output,
    ...pack.files.map(path => '-reference:' + (path === runtime ? replacement : path)), source], { encoding: 'utf8', timeout: 30_000 });
  if (compiled.stdout?.trim()) process.stdout.write(compiled.stdout);
  if (compiled.stderr?.trim()) process.stderr.write(compiled.stderr);
  if (compiled.status !== 0) throw new Error('Roslyn legacy-contract fixture failed: ' + (compiled.error?.message ?? compiled.status));
  const assembly = readFileSync(output);
  const provenance = {
    generator: 'build-legacy-fixture.mjs', sdk,
    compiler: execFileSync(dotnet, [compiler, '-version'], { encoding: 'utf8', timeout: 10_000 }).trim(),
    referencePack: pack.version, targetFramework: pack.targetFramework, options,
    source: 'NullableMetadata.cs', sourceSha256: sha256(readFileSync(source)), assemblySha256: sha256(assembly),
    referenceProjection: {
      description: 'Temporary same-length TypeDef name edits in a copy of System.Runtime.dll; not a historical SDK.',
      originalSha256: sha256(original), projectedSha256: sha256(projected.bytes), renamed: projected.renamed,
    },
  };
  writeFileSync(join(here, 'legacy-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  writeFileSync(join(here, 'roslyn-legacy-attributes.json'), JSON.stringify(nullableAttributeRows(assembly), null, 2) + '\n');
  writeFileSync(join(here, 'roslyn-embedded-definitions.json'), JSON.stringify(embeddedAttributeDefinitions(assembly), null, 2) + '\n');
  if (sha256(readFileSync(runtime)) !== sha256(original)) throw new Error('The installed reference changed during capture.');
  process.stdout.write(`Roslyn ${provenance.compiler}; ${assembly.length} bytes; ${provenance.assemblySha256}\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
