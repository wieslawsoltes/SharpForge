#!/usr/bin/env node
/** Regenerates only this small metadata oracle with the installed Roslyn compiler; never uses SharpForge output. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateReferencePack } from '../../../packages/compiler/src/node/reference-pack.js';
import { nullableAttributeRows } from './inspect-metadata.mjs';

const root = process.env.DOTNET_ROOT;
if (!root) throw new Error('Set DOTNET_ROOT to the .NET SDK installation used for this oracle.');
const dotnet = process.env.DOTNET ?? join(root, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');
const sdk = readdirSync(join(root, 'sdk')).filter(version => existsSync(join(root, 'sdk', version, 'Roslyn', 'bincore', 'csc.dll')))
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true })).at(-1);
if (!sdk) throw new Error('No Roslyn compiler was found in DOTNET_ROOT.');
const compiler = join(root, 'sdk', sdk, 'Roslyn', 'bincore', 'csc.dll');
const pack = locateReferencePack();
if (!pack) throw new Error('No .NET reference pack was found.');
const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, 'NullableMetadata.cs');
const output = join(here, 'NullableMetadata.dll');
const options = ['-nologo', '-noconfig', '-nostdlib', '-target:library', '-deterministic', '-debug-', '-optimize+',
  '-langversion:preview', '-nullable:disable', '-unsafe', '-nowarn:CS8618,CS0067'];
const compiled = spawnSync(dotnet, [compiler, ...options, '-out:' + output,
  ...pack.files.map(reference => '-reference:' + reference), source], { encoding: 'utf8', timeout: 30_000 });
if (compiled.stdout?.trim()) process.stdout.write(compiled.stdout);
if (compiled.stderr?.trim()) process.stderr.write(compiled.stderr);
if (compiled.status !== 0) throw new Error('Roslyn fixture compilation failed: ' + (compiled.error?.message ?? compiled.status));
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const provenance = {
  generator: 'build-fixture.mjs',
  sdk,
  compiler: execFileSync(dotnet, [compiler, '-version'], { encoding: 'utf8', timeout: 10_000 }).trim(),
  referencePack: pack.version,
  targetFramework: pack.targetFramework,
  options,
  sourceSha256: sha256(source),
  assemblySha256: sha256(output),
};
writeFileSync(join(here, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
writeFileSync(join(here, 'roslyn-attributes.json'), JSON.stringify(nullableAttributeRows(readFileSync(output)), null, 2) + '\n');
process.stdout.write(`Roslyn ${provenance.compiler}; ${readFileSync(output).length} bytes; ${provenance.assemblySha256}\n`);
