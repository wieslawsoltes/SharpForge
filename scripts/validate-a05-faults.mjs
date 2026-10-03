// Rebuild the Roslyn fixture and compare actual .NET output with direct CIL output.
import {execFileSync} from 'node:child_process';
import {copyFileSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {strict as assert} from 'node:assert';
import {CilVirtualMachine} from '@sharpforge/runtime';

const root = fileURLToPath(new URL('../tests/fixtures/a05/runtime-faults/', import.meta.url));
const run = (...args) => execFileSync('dotnet', args, {cwd: root, encoding: 'utf8'});
const sdk = run('--version').trim();
run('build', 'RuntimeFaults.csproj', '-c', 'Release', '--nologo');
const native = run('bin/Release/net10.0/RuntimeFaults.dll').replaceAll('\r\n', '\n');
const bytes = readFileSync(root + 'bin/Release/net10.0/RuntimeFaults.dll');
const result = new CilVirtualMachine(bytes).run();
assert.equal(result.state, 'terminated', result.fault?.stack);
assert.equal(result.output, native);
assert.equal(native, 'ok\narithmetic\nsystem\nexception\n');
copyFileSync(root + 'bin/Release/net10.0/RuntimeFaults.dll', root + 'RuntimeFaults.dll');
const provenance = {sdk, node: process.version, assemblySha256: createHash('sha256').update(bytes).digest('hex'), command: 'node scripts/validate-a05-faults.mjs', nativeOutput: native, cilOutput: result.output};
writeFileSync(root + 'provenance.json', JSON.stringify(provenance, null, 2) + '\n');
console.log(JSON.stringify(provenance, null, 2));
