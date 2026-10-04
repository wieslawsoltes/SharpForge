import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const option = name => {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
};
const dotnet = option('--dotnet') ?? process.env.DOTNET ?? 'dotnet';
const scratch = path.resolve(option('--scratch') ?? path.join(root, 'artifacts/bcl-core-unicode-oracle'));
const source = new URL('../reference/unicode-capture/', import.meta.url);
const env = {...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1'};
mkdirSync(scratch, {recursive: true});
writeFileSync(path.join(scratch, 'global.json'), JSON.stringify({sdk: {version: '10.0.201', rollForward: 'disable'}}));
for (const name of ['Program.cs', 'UnicodeCapture.csproj']) copyFileSync(new URL(name, source), path.join(scratch, name));
const sdk = execFileSync(dotnet, ['--version'], {cwd: scratch, env, encoding: 'utf8'}).trim();
if (sdk !== '10.0.201') throw new Error('Unicode capture requires SDK 10.0.201, found ' + sdk);
execFileSync(dotnet, ['build', 'UnicodeCapture.csproj', '-c', 'Release', '-o', 'out', '--nologo', '-v', 'quiet'], {
  cwd: scratch, env, stdio: 'inherit'
});
const output = path.join(scratch, 'unicode.json');
execFileSync(dotnet, [path.join(scratch, 'out/UnicodeCapture.dll'), output], {cwd: scratch, env, stdio: 'inherit'});
const snapshot = JSON.parse(readFileSync(output, 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
snapshot.extractor = {
  sdk,
  sourceSHA256: sha256(readFileSync(new URL('Program.cs', source))),
  assemblySHA256: sha256(readFileSync(path.join(scratch, 'out/UnicodeCapture.dll')))
};
const destination = new URL('../reference/unicode-dotnet-10.0.5.json', import.meta.url);
writeFileSync(destination, JSON.stringify(snapshot, null, 2) + '\n');
console.log(`Captured ${snapshot.whitespace.length} whitespace units and ${snapshot.upper.length}/${snapshot.lower.length} casing mappings.`);
