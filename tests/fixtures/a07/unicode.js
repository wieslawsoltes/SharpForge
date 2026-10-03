import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

export const unicodeReference = JSON.parse(readFileSync(
  new URL('../../../packages/bcl-core/reference/unicode-dotnet-10.0.5.json', import.meta.url), 'utf8'));

let compiled;
export function withUnicodePlatform(engine, action) {
  compiled ??= compileToIL('class Program { static void Main() {} }');
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
  try { return action(vm.platform); }
  finally { vm.stop(); }
}

export function callString(platform, name, values, parameters = []) {
  const descriptor = findContracts('System.String', name).find(member =>
    member.parameters.join(',') === parameters.join(','));
  assert.ok(descriptor, name);
  return platform.heap.withRoots([], () => {
    const args = values.map(value => {
      if (typeof value !== 'string') return value;
      const reference = platform.heap.string(value);
      platform.heap.pins.push(reference);
      return reference;
    });
    const result = platform.invoke(descriptor, args);
    if (descriptor.result === 'string[]') return platform.heap.get(result).data.map(value => platform.native(value));
    return platform.native(result);
  });
}
