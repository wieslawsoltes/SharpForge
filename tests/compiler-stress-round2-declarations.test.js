import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';

// SF-A02-T30, stress round 2 (fourth batch): defects found by the round-2 stress programs, checked here without a
// .NET SDK. What the programs print on real .NET is pinned from Roslyn 5.3.0 in the reduced programs named in each
// test (packages/compiler/test/differential/fixtures/reduced/, run by tests/compiler-stress-corpus.test.js).

const codesOf = (source, severity) =>
  analyze([parse(new SourceText(source, 'Program.cs'))], {})
    .diagnostics.filter(entry => entry.severity === severity)
    .map(entry => entry.code);
const errorsOf = source => codesOf(source, 'error');
const warningsOf = source => codesOf(source, 'warning');

test('A02-T30 a field passed by reference or changed through a struct member is assigned: no CS0649', () => {
  const source = `struct Tally { public int Count; public void Increment() { Count++; } }
    class Node { public Node Left, Right; }
    class C {
      private int hits;
      private Tally tally;
      private int never;
      static void Bump(ref int value) { value++; }
      public int Run(Node node, bool left) {
        Bump(ref hits);
        tally.Increment();
        ref Node slot = ref (left ? ref node.Left : ref node.Right);
        slot = node;
        return hits + tally.Count + never;
      }
    }`;
  assert.deepEqual(warningsOf(source), ['CS0649'], 'only the field that is really never assigned is reported');
});

test('A02-T30 an interface converts to a sealed class that implements it through variance: no CS0184', () => {
  const source = `interface IProducer<out T> { T Produce(); }
    class Animal { } sealed class Lion : Animal { }
    sealed class Litter<T> : IProducer<T> where T : new() { public T Produce() => new T(); }
    sealed class Other { }
    class P { static bool M(IProducer<Animal> producer) => producer is Litter<Lion>; static bool N(IProducer<Animal> producer) => producer is Other; }`;
  assert.deepEqual(warningsOf(source), ['CS0184'], 'only the sealed class that does not implement the interface can never match');
});

test('A02-T30 `readonly ref` fields are written through; a readonly value field is still CS0191 (reduced-types/readonly-ref-fields)', () => {
  const refField = `ref struct Counter {
      private readonly ref int total;
      public Counter(ref int total) { this.total = ref total; }
      public void Push(int value) { total++; total += value; }
    }`;
  assert.deepEqual(errorsOf(refField), []);
  assert.deepEqual(errorsOf('class C { private readonly int total; public void Push() { total++; } }'), ['CS0191']);
});

test('A02-T30 extension methods of a `file static class` are in scope in their file (reduced-types/file-local-extension-class)', () => {
  const source = `namespace N;
    file static class Extras { public static int Twice(this int value) => value * 2; }
    class P { static int M() => 21.Twice(); }`;
  assert.deepEqual(errorsOf(source), []);
  assert.deepEqual(errorsOf('class P { static int M() => 21.Twice(); }'), ['CS1061']);
});

test('A02-T30 `with` on an anonymous type constructs a new instance from the written values and the receiver', () => {
  const source = `class P { static object M(int depth) { var a = new { Name = "x", Depth = 1 }; return a with { Depth = depth }; } static void Main() { } }`,
    result = compileToAssembly(source, { name: 'Sample' });
  assert.deepEqual(result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`), []);
  const inspector = new AssemblyInspector(result.assembly),
    type = inspector.types.find(candidate => candidate.name === 'P'),
    method = type.methods.find(candidate => candidate.name === 'M'),
    names = inspector.getMethod(method.token).instructions.map(instruction => instruction.name);
  // One instance for `new { ... }`, one for `with`; the unchanged member is read from the receiver.
  assert.equal(names.filter(name => name === 'newobj').length, 2, names.join(' '));
  assert.equal(names.filter(name => name === 'callvirt').length, 1, names.join(' '));
});
