import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';

// SF-A02-T30: ref safe contexts of `a[^1]` and of the iteration variable of a ref foreach, `return ref` out of a
// protected region, and re-targeting a `readonly ref` field. The codes are what Roslyn 5.3.0 reports for the same
// sources. Reference on real .NET: the Roslyn-pinned programs
// `reduced-types/ref-safe-contexts-of-elements-and-iteration` and `stress-spans/ref-returns-sorting`.

const errorsOf = members =>
  analyze([parse(new SourceText(`using System;\n${members}\nstatic class Program { static void Main() { } }`, 'Program.cs'))], {})
    .diagnostics.filter(entry => entry.severity === 'error')
    .map(entry => entry.code);
const method = body => `static class Refs { ${body} }`;

test('A02-T30 an element from the end and a ref iteration variable over a parameter span may be returned by reference', () => {
  assert.deepEqual(errorsOf(method('static ref int Last(int[] values) => ref values[^1];')), []);
  assert.deepEqual(errorsOf(method('static ref int Last(Span<int> values) { ref int cursor = ref values[0]; cursor = ref values[^1]; return ref cursor; }')), []);
  assert.deepEqual(errorsOf(method('static ref int First(Span<int> values, ref int none) { foreach (ref int item in values) return ref item; return ref none; }')), []);
  assert.deepEqual(errorsOf(method('static ref int Guarded(int[] values) { try { return ref values[0]; } finally { values[1] = 2; } }')), []);
});

test('A02-T30 what refers to the current method still may not leave it', () => {
  const local = 'Span<int> local = stackalloc int[3];';
  assert.deepEqual(errorsOf(method(`static ref int A() { ${local} foreach (ref int item in local) return ref item; throw null; }`)), ['CS8157']);
  assert.deepEqual(errorsOf(method('static ref int B(scoped Span<int> span) { foreach (ref int item in span) return ref item; throw null; }')), ['CS8157']);
  assert.deepEqual(errorsOf(method(`static ref int C() { ${local} return ref local[^1]; }`)), ['CS8352']);
  assert.deepEqual(errorsOf(method(`static ref int D() { ${local} ref int cursor = ref local[^1]; return ref cursor; }`)), ['CS8157']);
  assert.deepEqual(errorsOf(method(`static void F(ref Span<int> wide) { ${local} ref int outer = ref wide[0]; outer = ref local[^1]; }`)), ['CS8374']);
});

test('A02-T30 ref fields: readonly fixes the reference (CS0191), ref readonly the variable (CS8331)', () => {
  const holder = body => `ref struct Holder { public readonly ref int Slot; public ref readonly int View; public readonly ref readonly int Both;
    public Holder(ref int target) { Slot = ref target; View = ref target; Both = ref target; }
    public void Change(scoped ref int other, Span<int> heap) { ${body} } }`;
  assert.deepEqual(errorsOf(holder('Slot = 5; View = ref heap[0];')), []);
  assert.deepEqual(errorsOf(holder('Slot = ref heap[0];')), ['CS0191']);
  assert.deepEqual(errorsOf(holder('Both = ref heap[0];')), ['CS0191']);
  assert.deepEqual(errorsOf(holder('View = 6;')), ['CS8331']);
  assert.deepEqual(errorsOf(holder('Both = 7;')), ['CS8331']);
});
