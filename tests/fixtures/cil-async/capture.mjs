import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {AssemblyInspector, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {asyncNativeTimeout, loadAsyncToolchain} from '../../support/cil-async-toolchain.js';

const destination = process.argv[2];
assert.ok(destination, 'capture destination is required');
const execute = process.argv.includes('--execute');
const requested = process.argv.slice(3).filter(argument => argument !== '--execute');
const fixtureNames = requested.length ? requested : ['Completed', 'Suspended', 'Exceptions', 'Retention'];
const known = new Set(['Completed', 'Suspended', 'Exceptions', 'Retention', 'WaitAndDelay', 'Mutation',
  'GenericMethod', 'GenericOwner', 'GenericAggregateBoundary']);
assert.ok(fixtureNames.every(name => known.has(name)), 'capture requires checked-in fixture names');
mkdirSync(destination, {recursive: true});
const root = resolve('.');
const toolchain = loadAsyncToolchain();
assert.ok(toolchain.available, toolchain.reason);
const {pack, dotnet, sdk, compiler, runtimeConfig, languageVersion} = toolchain;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const capture = {sdk, referencePack: pack.pack.version, invocation: toolchain.invocation,
  runtimes: execFileSync(dotnet, ['--list-runtimes'], {encoding: 'utf8'}).trim(),
  head: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  trackedDiff: execFileSync('git', ['diff', '--name-only'], {encoding: 'utf8'}).trim(), entries: []};
function executeImage(bytes) {
  try {
    const vm = new CilVirtualMachine(bytes, {virtualTime: true});
    let result = vm.run();
    for (let turn = 0; turn < 100 && result.state === 'waiting'; turn++) {
      const delay = vm.scheduler.nextDelay();
      if (delay === null) break;
      vm.scheduler.advance(delay);
      result = vm.run();
    }
    return {state: result.state, output: result.output,
      fault: result.fault ? {name: result.fault.name, message: result.fault.message} : null};
  } catch (error) {
    return {state: 'rejected', error: {name: error.name, message: error.message}};
  }
}

for (const name of fixtureNames) {
  const sourcePath = join(root, 'tests', 'fixtures', 'cil-async', name + '.cs');
  const source = readFileSync(sourcePath);
  for (const optimize of [false, true]) {
    const mode = optimize ? 'Release' : 'Debug', path = join(destination, name + mode + '.dll');
    const args = [compiler, '-nologo', '-noconfig', '-nostdlib', '-langversion:' + languageVersion, '-deterministic+',
      '-target:exe', '-optimize' + (optimize ? '+' : '-'), '-out:' + path,
      ...pack.pack.files.map(reference => '-reference:' + reference), sourcePath];
    const built = spawnSync(dotnet, args, {encoding: 'utf8', timeout: asyncNativeTimeout});
    assert.equal(built.status, 0, built.stdout + built.stderr);
    writeFileSync(path.replace(/\.dll$/, '.runtimeconfig.json'), JSON.stringify(runtimeConfig));
    const output = execFileSync(dotnet, [path], {encoding: 'utf8', timeout: asyncNativeTimeout}).replace(/\r\n/g, '\n');
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
    if (execute) {
      entry.cil = executeImage(bytes);
      entry.cil.matchesNative = entry.cil.state === 'terminated' && entry.cil.output === output;
    }
    capture.entries.push(entry);
    writeFileSync(join(destination, 'capture.json'), JSON.stringify(capture, null, 2) + '\n');
    console.log(name, mode, 'native OK;', machines.map(machine => machine.base).join(','),
      'CIL admission', report.success ? 'accepted' : 'rejected', execute ? entry.cil.state : '');
  }
}
console.log('Wrote', join(destination, 'capture.json'));
