/** Capture the selected Roslyn compiler's declaration contract, without restore or network access. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const arguments_ = process.argv.slice(2);
const required = name => {
  const index = arguments_.indexOf(name);
  if (index < 0 || !arguments_[index + 1]) throw new Error(`Required argument: ${name} <path>`);
  return resolve(arguments_[index + 1]);
};
const dotnet = required('--dotnet');
const sdk = required('--sdk');
const referencePack = required('--reference-pack');
const compiler = join(sdk, 'Roslyn', 'bincore', 'csc.dll');
const reference = join(referencePack, 'System.Runtime.dll');
const source = join(directory, 'DeclarationMetadata.cs');
const output = join(directory, 'DeclarationMetadata.dll');
const options = ['-nologo', '-noconfig', '-nostdlib+', '-target:library', '-langversion:14.0', '-nullable:enable',
  '-deterministic+', '-optimize+', '-debug-'];
const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' };
const compilerVersion = execFileSync(dotnet, [compiler, '-version'], { env, encoding: 'utf8' }).trim();
execFileSync(dotnet, [compiler, ...options, '-pathmap:' + directory + '=/src/exported-extension-blocks',
  '-out:' + output, '-r:' + reference, source], { env, stdio: 'inherit' });
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
writeFileSync(join(directory, 'provenance.json'), JSON.stringify({
  compiler: 'Roslyn C# compiler', compilerVersion, sdkVersion: basename(sdk), targetFramework: basename(referencePack),
  referencePackVersion: basename(dirname(dirname(referencePack))), options,
  source: { file: basename(source), sha256: hash(source) },
  assembly: { file: basename(output), sha256: hash(output) },
  reference: { file: basename(reference), sha256: hash(reference) },
  compilerBinary: { file: basename(compiler), sha256: hash(compiler) },
}, null, 2) + '\n');
console.log(`Generated ${basename(output)} with Roslyn ${compilerVersion}.`);
