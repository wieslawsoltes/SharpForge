import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '@sharpforge/compiler';
import { LocalAddress, TypedIlBuilder } from '../packages/compiler/src/emit/cil/il-stack-types.js';
import { restorePendingOperands, savePendingOperands } from '../packages/compiler/src/emit/cil/pending-operands.js';

// SF-A02-T30: an await (or a stackalloc) while the address of a struct local is on the evaluation stack - the
// receiver of `rate.ApplyAsync(await ...)`. The address is dropped and taken again after the suspension; the local
// is hoisted. Reference on real .NET: the Roslyn-pinned programs `reduced-async/await-with-struct-receiver-on-stack`
// and `stress-tasks/order-pipeline-whenall` (tests/compiler-stress-corpus.test.js).

const program = body => `using System.Threading.Tasks;
struct Counter { public int Total; public int Add(int amount) { Total += amount; return Total; } }
class Holder { public Counter Inner; }
static class Program {
  static async Task<int> Later(int value) { await Task.Yield(); return value; }
  static async Task Main() { Counter counter = new Counter(); Holder holder = new Holder(); ${body} }
}`;
const errorsOf = body =>
  compileToAssembly(program(body), { name: 'Fixture' })
    .diagnostics.filter(entry => entry.severity === 'error')
    .map(entry => entry.code + ' ' + entry.message);

test('A02-T30 await with the address of a struct local on the stack emits', () => {
  assert.deepEqual(errorsOf('int sum = counter.Add(await Later(1)) + counter.Add(await Later(2));'), []);
  assert.deepEqual(errorsOf('int value = 7; int order = value.CompareTo(await Later(7));'), []);
});

const emitterOver = il => ({ il, temp: type => il.declareLocal(type) });
const names = il => il.instructions.map(instruction => `${instruction.name} ${instruction.operand ?? ''}`.trim());

test('A02-T30 saving the stack: a value goes to a temporary, the address of a local is taken again', () => {
  const int = { name: 'int' },
    il = new TypedIlBuilder({ int }, []);
  const local = il.declareLocal(int);
  il.emit('ldc.i4', 5).emit('ldloca', local);
  assert.ok(il.pendingTypes[1] instanceof LocalAddress);
  const saved = savePendingOperands(emitterOver(il));
  assert.equal(il.depth, 0);
  il.emit('ldc.i4', 9);
  restorePendingOperands(emitterOver(il), saved, int);
  assert.equal(il.depth, 3);
  assert.deepEqual(names(il), ['ldc.i4 5', 'ldloca 0', 'pop', 'stloc 1', 'ldc.i4 9', 'stloc 2', 'ldloc 1', 'ldloca 0', 'ldloc 2']);
});

test('A02-T30 saving the stack: a by-reference local and a value of unknown type are refused, nothing is emitted', () => {
  const int = { name: 'int' },
    il = new TypedIlBuilder({ int }, []);
  const reference = il.declareLocal(int, { isByReference: true });
  il.emit('ldloca', reference);
  const before = il.instructions.length;
  assert.equal(savePendingOperands(emitterOver(il)), null);
  assert.equal(il.instructions.length, before);
});
