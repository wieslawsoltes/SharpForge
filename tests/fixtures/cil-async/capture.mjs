import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {AssemblyInspector, verifyCilAssembly} from '@sharpforge/cil';
import {loadReferencePack} from '@sharpforge/compiler/node';
import {dotnetHost, sdkVersion} from '../../../packages/compiler/test/differential/tools/dotnet-axis.mjs';

const destination = process.argv[2];
assert.ok(destination, 'capture destination is required');
mkdirSync(destination, {recursive: true});
const root = resolve('.');
const pack = loadReferencePack(), dotnet = dotnetHost(), sdk = sdkVersion(dotnet);
assert.ok(pack && sdk, 'genuine .NET reference pack and SDK are required');
const compiler = join(process.env.DOTNET_ROOT ?? dirname(dotnet), 'sdk', sdk, 'Roslyn', 'bincore', 'csc.dll');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const capture = {sdk, referencePack: pack.pack.version,
  runtimes: execFileSync(dotnet, ['--list-runtimes'], {encoding: 'utf8'}).trim(),
  head: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  trackedDiff: execFileSync('git', ['diff', '--name-only'], {encoding: 'utf8'}).trim(), entries: []};
const config = {runtimeOptions: {tfm: 'net' + sdk.split('.').slice(0, 2).join('.'),
  framework: {name: 'Microsoft.NETCore.App', version: sdk.split('.')[0] + '.0.0'}}};
for (const name of ['Completed', 'Suspended', 'Exceptions', 'Retention']) {
  const sourcePath = join(root, 'tests', 'fixtures', 'cil-async', name + '.cs');
  const source = readFileSync(sourcePath);
  for (const optimize of [false, true]) {
    const mode = optimize ? 'Release' : 'Debug', path = join(destination, name + mode + '.dll');
    const args = [compiler, '-nologo', '-noconfig', '-nostdlib', '-langversion:14', '-deterministic+',
      '-target:exe', '-optimize' + (optimize ? '+' : '-'), '-out:' + path,
      ...pack.pack.files.map(reference => '-reference:' + reference), sourcePath];
    const built = spawnSync(dotnet, args, {encoding: 'utf8', timeout: 30000});
    assert.equal(built.status, 0, built.stdout + built.stderr);
    writeFileSync(path.replace(/\.dll$/, '.runtimeconfig.json'), JSON.stringify(config));
    const output = execFileSync(dotnet, [path], {encoding: 'utf8', timeout: 30000}).replace(/\r\n/g, '\n');
    const bytes = new Uint8Array(readFileSync(path)), inspector = new AssemblyInspector(bytes);
    const report = verifyCilAssembly(inspector);
    const machines = inspector.types.filter(type => type.interfaces.some(token =>
      inspector.metadata.typeName(token) === 'System.Runtime.CompilerServices.IAsyncStateMachine')).map(type => ({
      name: type.name, base: inspector.metadata.typeName(type.baseToken),
      methods: type.methods.map(method => ({name: method.name, token: method.token}))
    }));
    const entry = {name, mode, sourceSha256: sha256(source), assemblySha256: sha256(bytes), bytes: bytes.length,
      command: [dotnet, ...args], compilerOutput: built.stdout + built.stderr, output, machines,
      verifier: {success: report.success, methods: report.methods, issues: report.issues}};
    capture.entries.push(entry);
    writeFileSync(join(destination, 'capture.json'), JSON.stringify(capture, null, 2) + '\n');
    console.log(name, mode, 'native OK;', machines.map(machine => machine.base).join(','),
      'CIL admission', report.success ? 'accepted' : 'rejected');
  }
}
console.log('Wrote', join(destination, 'capture.json'));
