// SF-A02-T10.6: object, collection, nested and index initializers bind like Roslyn and run on both back ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { walk } from '../packages/compiler/src/bound/semantic-walker.js';
import { testPinnedFeature } from './support/pinned-feature.js';
import { linesOf } from './support/semantic-codegen.js';

testPinnedFeature('SF-A02-T10.6', 'member-initializers', { outputs: 9, diagnostics: 13 });

/** Every object creation node of the bound bodies of a program. */
function creationsOf(source) {
  const analysis = analyze([parse(new SourceText(source, 'a.cs'))]);
  assert.deepEqual(
    analysis.diagnostics.filter(d => d.severity === 'error').map(d => d.code),
    [],
  );
  const found = [];
  for (const body of analysis.bound.values()) walk(body, node => (node.kind === 'ObjectCreation' ? found.push(node) : true));
  return found;
}

test('SF-A02-T10.6 bound shape: member, index and nested initializers and Add calls', () => {
  const [creation] = creationsOf(`
    using System.Collections.Generic;
    class Inner { public int Value; }
    class Box {
      public int Plain;
      public Inner Inner = new Inner();
      public List<int> Items = new List<int>();
      public int this[int i] { get { return i; } set { } }
    }
    class Program { static void Main() { var b = new Box { Plain = 1, [2] = 3, Inner = { Value = 4 }, Items = { 5, 6 } }; } }`).filter(
    node => node.initializers?.length,
  );
  const [plain, index, nested, items] = creation.initializers;
  assert.equal(plain.target.kind, 'FieldAccess');
  assert.equal(plain.target.isInitializerTarget, true);
  assert.equal(index.target.kind, 'IndexerAccess');
  assert.equal(index.target.receiver.kind, 'ImplicitReceiver');
  assert.equal(nested.value.kind, 'ObjectInitializer');
  assert.equal(nested.value.initializers[0].target.field.name, 'Value');
  assert.equal(items.value.kind, 'ObjectInitializer');
  assert.deepEqual(
    items.value.collectionInitializers.map(call => [call.kind, call.method.name, call.receiver.kind]),
    [
      ['Call', 'Add', 'ImplicitReceiver'],
      ['Call', 'Add', 'ImplicitReceiver'],
    ],
  );
});

test('SF-A02-T10.6 an extension Add is bound as an extension call on the object being initialized', () => {
  const creations = creationsOf(`
    using System.Collections.Generic;
    static class E { public static void Add(this List<int> list, string text) { list.Add(text.Length); } }
    class Program { static void Main() { var l = new List<int> { 1, "two" }; } }`);
  const calls = creations.find(node => node.collectionInitializers?.length).collectionInitializers;
  assert.deepEqual(
    calls.map(call => call.isExtension),
    [false, true],
  );
  assert.equal(calls[1].args[0].expression.kind, 'ImplicitReceiver');
});

test('SF-A02-T10.6 a static initializer may create a class whose instance initializers are declared later', () => {
  const lines = linesOf(`
    using System;
    class Program {
      static Later later = new Later { Extra = 2 };
      static void Main() { Console.WriteLine(later.Name + later.Extra); }
    }
    class Later { public string Name = "set"; public int Extra; }`);
  assert.deepEqual(lines, ['set2']);
});
