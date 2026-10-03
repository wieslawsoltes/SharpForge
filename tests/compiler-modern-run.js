/**
 * Shared helpers of the C# 13-15 semantic tests (SF-A02-E11, SF-A02-E12): compile a program, run it on the
 * bytecode VM and on the CIL VM, and read its C# diagnostics as `code:text` rows.
 */
import assert from 'node:assert/strict';
import { compile, compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

/** Output of `source` on both back ends; fails on a compile error or when the back ends disagree. */
export function runOnBothBackEnds(source, options = {}) {
  const result = compile(source, options);
  assert.deepEqual(
    result.diagnostics.filter(d => d.severity === 'error').map(d => d.code + ' ' + d.message),
    [],
  );
  const il = compileToIL(source, { ...options, includeDebug: false });
  assert.equal(il.success, true);
  const bytecode = new VirtualMachine(result.image).run().output,
    cil = new CilVirtualMachine(il.assembly).run().output;
  assert.equal(cil, bytecode);
  return bytecode;
}

/** The C# errors of `source` as `CSxxxx:<source text of the span>`, in report order. */
export function errorsOf(source, options = {}) {
  return compile(source, options)
    .diagnostics.filter(d => d.severity === 'error' && d.code.startsWith('CS'))
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
}

/** Every diagnostic code of `source` (C# and profile codes), in report order. */
export function codesOf(source, options = {}) {
  return compile(source, options).diagnostics.map(d => d.code);
}
