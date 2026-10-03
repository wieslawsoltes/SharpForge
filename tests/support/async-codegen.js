import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

/** Runs a machine until it ends; when every context waits, virtual time jumps to the next deadline. */
function runToEnd(vm) {
  let result = vm.run();
  for (let step = 0; step < 10_000 && result.state === 'waiting'; step++) {
    const delay = vm.scheduler.nextDelay();
    if (delay === null) break;
    vm.scheduler.advance(delay);
    result = vm.run();
  }
  return result;
}

/**
 * Compiles an asynchronous program, runs it to its end on the bytecode VM and on the CIL VM under virtual time,
 * checks that both print the same and returns `{lines, image, result}`.
 */
export function runAsyncOnBothBackEnds(source, options = {}) {
  const result = compile(source, options);
  const errors = result.diagnostics.filter(d => d.severity === 'error');
  assert.deepEqual(
    errors.map(d => `${d.code} ${d.message}`),
    [],
  );
  assert.ok(result.image, 'an image is produced');
  const bytecode = runToEnd(new VirtualMachine(result.image, { virtualTime: true }));
  assert.equal(bytecode.state, 'terminated', bytecode.fault ? `${bytecode.fault.name}: ${bytecode.fault.message}` : bytecode.state);
  const il = compileToIL(source, { ...options, includeDebug: false });
  assert.ok(il.assembly, 'an assembly is produced: ' + il.diagnostics.map(d => d.message).join('; '));
  const cil = runToEnd(new CilVirtualMachine(il.assembly, { virtualTime: true }));
  assert.equal(cil.state, 'terminated', cil.fault ? `${cil.fault.name}: ${cil.fault.message}` : cil.state);
  assert.equal(cil.output, bytecode.output, 'both back ends print the same');
  return { lines: bytecode.output.trimEnd().split('\n'), image: result.image, result };
}
