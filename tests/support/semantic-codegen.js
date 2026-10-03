import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

/**
 * Compiles a program that is outside the string-typed execution profile, runs it on the bytecode VM and on the CIL
 * VM, checks that both print the same and returns `{output, image, result}`.
 */
export function runOnBothBackEnds(source, options = {}) {
  const result = compile(source, options);
  const errors = result.diagnostics.filter(d => d.severity === 'error');
  assert.deepEqual(
    errors.map(d => `${d.code} ${d.message}`),
    [],
  );
  assert.ok(result.image, 'an image is produced');
  const bytecode = new VirtualMachine(result.image).run();
  assert.equal(bytecode.fault, null, bytecode.fault ? `${bytecode.fault.name}: ${bytecode.fault.message}` : '');
  const il = compileToIL(source, { ...options, includeDebug: false });
  assert.ok(il.assembly, 'an assembly is produced: ' + il.diagnostics.map(d => d.message).join('; '));
  const cil = new CilVirtualMachine(il.assembly).run();
  assert.equal(cil.fault, null, cil.fault ? `${cil.fault.name}: ${cil.fault.message}` : '');
  assert.equal(cil.output, bytecode.output, 'both back ends print the same');
  return { output: bytecode.output, image: result.image, result };
}

/** The lines a program prints on both back ends. */
export function linesOf(source, options = {}) {
  return runOnBothBackEnds(source, options).output.trimEnd().split('\n');
}

/** Compiles a program expected to be valid C# that the runtime cannot execute: returns the SF2200 diagnostics. */
export function notExecutable(source, options = {}) {
  const result = compile(source, options);
  assert.equal(result.image, null, 'no image is produced');
  assert.equal(result.success, false);
  const reported = result.diagnostics.filter(d => d.code === 'SF2200');
  assert.equal(reported.length, 1, 'exactly one SF2200: ' + result.diagnostics.map(d => d.code + ' ' + d.message).join('; '));
  return reported[0];
}
