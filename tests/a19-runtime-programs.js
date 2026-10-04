import assert from 'node:assert/strict';
import { compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

export function compileProgram(source, options = {}) {
  const compiled = compileToIL(source, { includeDebug: false, portablePdb: false, ...options });
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  return compiled;
}

export function programVM(compiled, engine, options = {}) {
  return engine === 'source'
    ? new VirtualMachine(compiled.image, options)
    : new CilVirtualMachine(compiled.assembly, options);
}

export async function runProgram(compiled, engine, options = {}) {
  const vm = programVM(compiled, engine, { virtualTime: true, ...options });
  try {
    const result = await vm.runAsync();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    return result;
  } finally {
    vm.stop();
  }
}
