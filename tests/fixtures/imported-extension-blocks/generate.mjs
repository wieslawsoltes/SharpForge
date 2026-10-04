/** Regenerates the C# 14 reference fixture with an explicitly selected .NET SDK, without restore or network access. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const required = name => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Required argument: ${name} <path>`);
  return resolve(args[index + 1]);
};
const dotnet = required('--dotnet');
const sdk = required('--sdk');
const referencePack = required('--reference-pack');
const compiler = join(sdk, 'Roslyn', 'bincore', 'csc.dll');
const source = join(directory, 'ExtensionLibrary.cs');
const legacyMarker = join(directory, 'LegacyMarker.cs');
const output = join(directory, 'ExtensionLibrary.dll');
const reference = join(referencePack, 'System.Runtime.dll');
const options = ['-noconfig', '-nostdlib+', '-nologo', '-target:library', '-langversion:14.0', '-nullable:enable',
  '-deterministic+', '-optimize+', '-debug-'];
const mappedSourceDirectory = '/src/imported-extension-blocks';
const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' };
const version = execFileSync(dotnet, [compiler, '-version'], { env, encoding: 'utf8' }).trim();
execFileSync(dotnet, [compiler, ...options, '-pathmap:' + directory + '=' + mappedSourceDirectory,
  '-out:' + output, '-r:' + reference, source, legacyMarker], { env, stdio: 'inherit' });
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const provenance = {
  compiler: 'Roslyn C# compiler',
  compilerVersion: version,
  sdkVersion: basename(sdk),
  targetFramework: basename(referencePack),
  referencePackVersion: basename(dirname(dirname(referencePack))),
  options,
  sourceDirectoryPathMap: mappedSourceDirectory,
  source: { file: basename(source), sha256: sha256(source) },
  additionalSources: [{ file: basename(legacyMarker), sha256: sha256(legacyMarker) }],
  assembly: { file: basename(output), sha256: sha256(output) },
  reference: { file: basename(reference), sha256: sha256(reference) },
  compilerBinary: { file: basename(compiler), sha256: sha256(compiler) },
  metadataContract: 'https://github.com/dotnet/csharplang/blob/main/proposals/csharp-14.0/extensions.md',
};
writeFileSync(join(directory, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(`Generated ${basename(output)} with Roslyn ${version}.`);
