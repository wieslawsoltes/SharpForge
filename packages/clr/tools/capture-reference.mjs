import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const source = join(root, 'tests/fixtures/clr-identity');
const output = resolve(process.argv[2] ?? join(root, 'artifacts/clr-reference'));
const temporary = mkdtempSync(join(tmpdir(), 'sharpforge-clr-reference-'));
const run = (args, options = {}) => execFileSync('dotnet', args, {
  cwd: temporary, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' }, ...options,
});
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n');

try {
  mkdirSync(output, { recursive: true });
  for (const file of ['Program.cs', 'oracle.csproj']) copyFileSync(join(source, file), join(temporary, file));
  writeFileSync(join(temporary, 'NuGet.Config'), '<configuration><packageSources><clear /></packageSources></configuration>');
  const sdk = run(['--version']).trim();
  run(['build', '--configuration', 'Release', '--nologo', '--verbosity', 'quiet', '--disable-build-servers', '-m:1']);
  const app = join(temporary, 'bin/Release/net10.0');
  const assembly = join(app, 'oracle.dll');
  const names = JSON.parse(run([assembly, 'names', join(source, 'inputs.json')]));
  save('assembly-names.json', { sdk, ...names });
  save('public-keys.json', { sdk, runtime: names.runtime, cases: JSON.parse(run([assembly, 'keys'])) });
  save('frameworks.json', { sdk, runtime: names.runtime,
    cases: JSON.parse(run([assembly, 'frameworks', join(source, 'framework-inputs.json')])) });
  const tracePath = join(temporary, 'host.trace');
  const trusted = JSON.parse(run(['exec', '--depsfile', join(app, 'oracle.deps.json'), assembly, 'trusted'], {
    env: { ...process.env, DOTNET_HOST_TRACE: '1', DOTNET_HOST_TRACEFILE: tracePath, DOTNET_HOST_TRACE_VERBOSITY: '4' },
  }));
  const trace = readFileSync(tracePath, 'utf8');
  const applicationRoot = realpathSync(app);
  const applicationPaths = trusted.paths.filter(path => realpathSync(path).startsWith(applicationRoot + '/'));
  if (applicationPaths.length < 2) throw new Error('Native trusted assembly list must contain the app and NuGet.Frameworks');
  for (const path of applicationPaths) {
    if (!trace.includes(path)) throw new Error(`Host trace omitted trusted application path ${basename(path)}`);
  }
  copyFileSync(join(app, 'oracle.deps.json'), join(output, 'published.deps.json'));
  copyFileSync(join(app, 'oracle.runtimeconfig.json'), join(output, 'published.runtimeconfig.json'));
  save('trusted-paths.json', { sdk, runtime: trusted.runtime, traceSha256: createHash('sha256').update(trace).digest('hex'),
    command: ['dotnet', 'exec', '--depsfile', '$APP/oracle.deps.json', '$APP/oracle.dll', 'trusted'],
    applicationPaths: applicationPaths.map(path => '$APP/' + basename(path)).sort() });
  console.log(`Captured native CLR reference evidence in ${output}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
