import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { runToEnd } from '../packages/compiler/test/differential/run-program.js';

// SF-A02-T30: lambdas as values and awaits between operands - the SF2200 ("valid C# but not executable") cases and
// one silently ignored attribute that the stress family of the differential corpus exposed. The reduced programs are
// the corpus fixtures `reduced-functional/lambdas-as-values`, `reduced-async/await-in-operands` and
// `reduced-async/async-stream-cancellation` (pinned from Roslyn 5.3.0, run on .NET 10.0.5 by
// tests/compiler-stress-corpus.test.js); here the same is checked without a .NET SDK where the direct-CIL VM can.

function emit(source, options = {}) {
  const result = compileToAssembly(source, { name: 'Sample', ...options });
  assert.deepEqual(result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`), []);
  return result;
}

function run(source) {
  const outcome = runToEnd(new CilVirtualMachine(emit(source).assembly, { maxInstructions: 1_000_000, virtualTime: true }));
  assert.equal(outcome.state, 'terminated', String(outcome.fault?.message ?? outcome.state));
  return outcome.output;
}

const pack = loadReferencePack(),
  skip = pack ? false : 'no .NET reference pack is installed',
  references = pack ? { references: pack.references } : {};

test('A02-T30 a lambda is bound wherever it is converted: an initializer value, an operand of ?:, an array element', () => {
  const output = run(`using System;
    class Handlers {
      public Func<int, int> Step;
      Func<int, int> indexed;
      public Func<int, int> this[int index] { get { return indexed; } set { indexed = value; } }
    }
    class P {
      static void Main() {
        var handlers = new Handlers { Step = x => x + 1, [0] = x => x - 1 };
        bool twice = true;
        Func<int, int> doubled = x => x * 2, chosen = twice ? doubled : x => x, other = !twice ? doubled : x => x + 100;
        Func<int, int>[] many = { x => x + 1, x => x * x };
        Console.WriteLine(handlers.Step(5) + " " + handlers[0](5) + " " + chosen(4) + " " + other(4) + " " + many[1](5));
      }
    }`);
  assert.equal(output, '6 4 8 104 25\n');
});

test('A02-T30 a lambda converted to a ref-returning delegate returns the address', () => {
  const result = emit(`delegate ref int Selector(int[] items);
    class P {
      static void Main() {
        Selector last = items => ref items[items.Length - 1];
        int[] data = { 1, 2, 3 };
        last(data) = 30;
        last(data) += 5;
        System.Console.WriteLine(data[2]);
      }
    }`);
  const inspector = new AssemblyInspector(result.assembly),
    lambda = inspector.types.flatMap(type => type.methods).find(method => method.name.includes('b__')),
    names = inspector.getMethod(lambda.token).instructions.map(instruction => instruction.name);
  // The body ends with the element's address (it returned the element's value, which the caller then used as a pointer).
  assert.ok(names.includes('ldelema'), names.join(' '));
  assert.ok(!names.includes('ldelem.i4'), names.join(' '));
});

test('A02-T30 an async lambda returns the result type of any task-like delegate return type', { skip }, () => {
  emit(
    `using System; using System.Threading.Tasks;
    class P {
      static async Task Main() {
        Func<int, ValueTask<bool>> even = async n => { await Task.Yield(); return n % 2 == 0; };
        Func<ValueTask> nothing = async () => { await Task.Yield(); };
        await nothing();
        Console.WriteLine(await even(2));
      }
    }`,
    references,
  );
});

test('A02-T30 an await between the holes of an interpolated string, params arguments and array elements', () => {
  // (The direct-CIL VM does not run an async entry point: these two programs are emitted here and run on .NET as fixtures.)
  emit(`using System;
    using System.Threading.Tasks;
    class P {
      static async Task<int> Later(int value) { await Task.Delay(1); return value; }
      static int Sum(params int[] values) { int total = 0; foreach (int value in values) total += value; return total; }
      static async Task Main() {
        int saved = 3;
        Console.WriteLine($"saved {saved}, again {await Later(7)}, last {await Later(8)}");
        Console.WriteLine(Sum(1, await Later(2), 3, await Later(4)));
        int[] array = { saved, await Later(6), saved * 2, await Later(7) };
        Console.WriteLine(array[0] + array[1] + array[2] + array[3]);
      }
    }`);
});

test('A02-T30 a compound assignment whose operand awaits reads the target first and stores after the await', () => {
  const result = emit(`using System;
    using System.Threading.Tasks;
    struct Counter { public int Value; }
    class P {
      static int shared = 1;
      int balance = 10;
      static async Task<int> Later(int value) { await Task.Delay(1); return value; }
      static async Task<int> BumpAndReturn(int value) { await Task.Delay(1); shared += 100; return value; }
      async Task<int> Update() { balance += await Later(5); balance *= await Later(2); return balance; }
      static async Task Main() {
        var counter = new Counter();
        int local = 1;
        for (int i = 1; i <= 3; i++) { counter.Value += await Later(i); local -= await Later(1); }
        shared += await BumpAndReturn(5);
        Console.WriteLine(counter.Value + " " + local + " " + shared + " " + await new P().Update());
      }
    }`);
  // `shared += await ...` adds to the value read before the await: in MoveNext the static field is read (ldsfld) before
  // the awaiter is asked whether it is completed, and written (stsfld) after its result is taken.
  const inspector = new AssemblyInspector(result.assembly),
    machine = inspector.types.find(type => type.name.includes('<Main>d__')),
    moveNext = machine.methods.find(method => method.name === 'MoveNext'),
    names = inspector.getMethod(moveNext.token).instructions.map(instruction => instruction.name);
  assert.ok(names.includes('ldsfld') && names.indexOf('ldsfld') < names.lastIndexOf('stsfld'), 'reads shared, then stores it');
});
