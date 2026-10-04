import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const normalize = value => value.replaceAll('\r\n', '\n');

/** Compare the exact native source and observed output in all compiler-generated routes. */
export function qualifyNativeSourceRoutes(sources, native, nativeIntBits) {
  assert.equal(sources.length, 1, 'Source-route qualification requires one exact C# input');
  assert([32, 64].includes(nativeIntBits), 'Source routes require an observed native pointer width');
  assert.equal(native.exitCode, 0, 'Source routes require successful native execution');
  assert.equal(native.signal ?? null, null, 'Source routes cannot qualify an abnormal native exit');
  const bytes = sources[0].bytes;
  const compiled = compileToIL(bytes.toString('utf8'), {pipeline: 'bound'});
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const settings = {nativeIntBits};
  const engines = [
    ['source', () => new VirtualMachine(compiled.image, settings)],
    ['reloaded-source', () => new VirtualMachine(loadAssembly(compiled.assembly), settings)],
    ['compiled-cil', () => new CilVirtualMachine(compiled.assembly, settings)]
  ];
  const routes = [];
  for (const [engine, create] of engines) {
    const vm = create();
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', engine + ': ' + result.fault?.message);
      assert.equal(result.exitCode, native.exitCode, engine + '/native exit code');
      assert.equal(normalize(result.output), native.output, engine + '/native stdout');
      routes.push({engine, state: result.state, exitCode: result.exitCode,
        output: normalize(result.output), instructions: vm.instructions});
    } finally { vm.stop(); }
  }
  return {nativeIntBits, sourceSha256: hash(bytes), assemblySha256: hash(compiled.assembly), routes};
}
