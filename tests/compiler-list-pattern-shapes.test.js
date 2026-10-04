import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { runToEnd } from '../packages/compiler/test/differential/run-program.js';

// SF-A02-T30: list patterns over every countable, indexable type (they were arrays only), positional patterns over
// an `object` (ITuple), and constants over a nullable input. Reference: the corpus fixtures `reduced-patterns/list-
// patterns-over-indexable-types` and `reduced-patterns/constants-over-nullable` are pinned from Roslyn 5.3.0 and run
// on .NET 10.0.5 (tests/compiler-stress-corpus.test.js).

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

/** The members the calls of a method name, as `Owner::Member`. */
function callsOf(result, owner, name) {
  const inspector = new AssemblyInspector(result.assembly),
    method = inspector.types.find(type => type.name === owner).methods.find(candidate => candidate.name === name);
  return inspector
    .getMethod(method.token)
    .instructions.filter(instruction => instruction.name === 'call' || instruction.name === 'callvirt')
    .map(instruction => inspector.resolveToken(instruction.operand))
    .map(target => `${target.owner}::${target.name}`);
}

const codesOf = source =>
  compileToAssembly(source, { name: 'Sample' })
    .diagnostics.filter(entry => entry.severity === 'error')
    .map(entry => entry.code);

const pack = loadReferencePack(),
  skip = pack ? false : 'no .NET reference pack is installed',
  references = pack ? { references: pack.references } : {};

test('A02-T30 a list pattern over a type with Count and an int indexer', () => {
  const output = run(`using System;
    sealed class Ring {
      readonly int[] items;
      public Ring(params int[] items) { this.items = items; }
      public int Count { get { return items.Length; } }
      public int this[int index] { get { return items[index]; } }
    }
    class P {
      static string Kind(Ring ring) {
        return ring switch { [] => "empty", [var only] => "one " + only, [1, .., 3] => "1..3", [_, _] => "two", [.., > 8] => "ends big", _ => "other" };
      }
      static void Main() {
        Console.WriteLine(Kind(new Ring()) + "; " + Kind(new Ring(7)) + "; " + Kind(new Ring(1, 2, 3)) + "; " + Kind(new Ring(4, 5)) + "; " + Kind(new Ring(4, 5, 9)) + "; " + Kind(new Ring(4, 5, 6)));
        Ring none = null;
        Console.WriteLine((none is []) + " " + (new Ring(2) is [2] and { Count: 1 }));
      }
    }`);
  assert.equal(output, 'empty; one 7; 1..3; two; ends big; other\nFalse True\n');
});

test('A02-T30 a list pattern over a string reads Length, the characters and Substring', () => {
  const result = emit(`class P {
      static string Text(string text) { return text switch { ['#', .. var rest] => rest, [.., '!'] => "shout", [var c] => c.ToString(), _ => "other" }; }
      static void Main() { System.Console.WriteLine(Text("#tag") + Text("Hey!") + Text("x") + Text("")); }
    }`);
  assert.deepEqual([...new Set(callsOf(result, 'P', 'Text'))].slice(0, 3), ['System.String::get_Length', 'System.String::get_Chars', 'System.String::Substring']);
});

test('A02-T30 a list pattern over spans and lists, and a slice a type cannot give', { skip }, () => {
  const result = emit(
    `using System; using System.Collections.Generic;
    class P {
      static int Total(ReadOnlySpan<int> values) { return values switch { [] => 0, [var head, .. var tail] => head + Total(tail) }; }
      static string Words(IReadOnlyList<string> words) { return words switch { [] => "none", [var first, .., var last] => first + last, [var only] => only }; }
      static void Main() { Console.WriteLine(Total(new[] { 1, 2, 3 }) + Words(new List<string> { "a", "b" })); }
    }`,
    references,
  );
  assert.ok(callsOf(result, 'P', 'Total').some(target => target.endsWith('::Slice')));
  // IReadOnlyList<T> has no way to take a slice: `.. var middle` over it is refused, not emitted wrongly.
  const refused = compileToAssembly(
    'using System.Collections.Generic; class P { static int F(IReadOnlyList<int> list) { return list is [_, .. var middle] ? 1 : 0; } static void Main() { } }',
    { name: 'Sample', ...references },
  );
  assert.equal(refused.assembly, null);
});

test('A02-T30 a positional pattern over an object is an ITuple test', { skip }, () => {
  const result = emit(
    `class P {
      static string Kind(object value) { return value switch { (int a, int b) and not (0, 0) => "pair", (0, 0) => "origin", (string name, _, _) => name, _ => "other" }; }
      static void Main() { System.Console.WriteLine(Kind((1, 2)) + Kind((0, 0)) + Kind(("n", 1, 2)) + Kind("text")); }
    }`,
    references,
  );
  const calls = callsOf(result, 'P', 'Kind');
  assert.ok(calls.includes('System.Runtime.CompilerServices.ITuple::get_Length') && calls.includes('System.Runtime.CompilerServices.ITuple::get_Item'));
});

test('A02-T30 a constant pattern over a nullable input compares its value', () => {
  const result = emit(`class P {
      static bool IsOne(int? value) { return value is 1; }
      static bool IsNull(int? value) { return value is null; }
      static void Main() { System.Console.WriteLine(IsOne(1) && IsNull(null)); }
    }`);
  // `value is 1` was emitted as the null test (`!value.HasValue`): the answers were inverted.
  assert.ok(callsOf(result, 'P', 'IsOne').some(target => target.endsWith('::GetValueOrDefault')));
  assert.ok(!callsOf(result, 'P', 'IsNull').some(target => target.endsWith('::GetValueOrDefault')));
});

test('A02-T30 a type that is not countable and indexable is still an error for a list pattern', () => {
  assert.deepEqual(codesOf('class P { static bool F(int value) { return value is [1]; } static void Main() { } }'), ['CS8985', 'CS0021']);
});
