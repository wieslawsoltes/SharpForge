import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {parse} from '@sharpforge/syntax';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {FrameworkMembers} from '../packages/compiler/src/binder/framework-members.js';

const prefix = 'using System;using System.Collections.Generic;';
const engines = {source: result => new VirtualMachine(result.image), cil: result => new CilVirtualMachine(result.assembly)};
const programs = [
  {
    name: 'direct Sort argument preserves nullable ordinal ordering',
    source: `
      var values = new List<string>(new string[] {"b", "A", "a", null, "", "A"});
      values.Sort(StringComparer.Ordinal);
      for (int i = 0; i < values.Count; i++) Console.WriteLine(values[i] == null ? "<null>" : values[i]);
    `,
    output: '<null>\n\nA\nA\na\nb\n'
  },
  {
    name: 'registered interface locals, parameters and returns retain reference identity',
    source: `
      class Program {
        static IComparer<string> Create() { return StringComparer.Ordinal; }
        static IComparer<string> Echo(IComparer<string> value) { return value; }
        static void Sort(List<string> values, IComparer<string> comparer) { values.Sort(comparer); }
        static void Main() {
          IComparer<string> comparer = Create();
          var values = new List<string>(new string[] {"b", "A", "a"});
          Sort(values, Echo(comparer));
          Console.WriteLine(string.Join(",", values.ToArray()));
          Console.WriteLine(comparer.Compare("a", "A") > 0);
          Console.WriteLine(Object.ReferenceEquals(comparer, StringComparer.Ordinal));
        }
      }
    `,
    output: 'A,a,b\nTrue\nTrue\n'
  },
  {
    name: 'null comparer uses the existing default and null receiver still faults',
    source: `
      IComparer<string> comparer = null;
      var values = new List<string>(new string[] {"2", "1"});
      values.Sort(comparer);
      Console.WriteLine(string.Join(",", values.ToArray()));
      try { comparer.Compare("a", "b"); }
      catch (Exception error) { Console.WriteLine(error.GetType().Name); }
    `,
    output: '1,2\nNullReferenceException\n'
  }
];

for (const pipeline of ['bound', 'legacy']) {
  for (const [engine, create] of Object.entries(engines)) {
    for (const program of programs) {
      test(`registered comparer ${pipeline}/${engine}: ${program.name}`, () => {
        const result = compileToIL(prefix + program.source, {pipeline});
        assert.equal(result.success, true, JSON.stringify(result.diagnostics));
        const vm = create(result);
        try {
          const actual = vm.run();
          assert.equal(actual.state, 'terminated', actual.fault?.stack);
          assert.equal(actual.output, program.output);
        } finally { vm.stop(); }
      });
    }
  }
}

test('registered comparer: framework overload selection accepts only the registered assignable interface', () => {
  const members = new FrameworkMembers();
  const owner = 'System.Collections.Generic.List`1<string>';
  const candidates = members.methods(owner, 'Sort', false);
  const resolve = type => members.resolve(candidates, [{type: members.typeOf(type)}], {name: 'Sort'});
  const result = resolve('System.StringComparer');
  assert.equal(result.succeeded, true, JSON.stringify(result.error));
  assert.equal(result.method.contract.id, 589824);
  for (const source of ['object', 'string', 'System.Collections.Generic.IComparer`1<object>']) {
    // Contravariant IComparer<object> is a valid C# conversion, but no registered edge authorizes this runtime path.
    assert.equal(resolve(source).succeeded, false, source);
  }
});

test('registered comparer: wrong and unrelated interfaces remain compile-time errors', () => {
  const cases = [
    ['IComparer<object> comparer = StringComparer.Ordinal;', 'CS0266'],
    ['IDisposable value = StringComparer.Ordinal;', 'CS0266'],
    ['new List<string>().Sort(new object());', 'CS1501'],
    ['object comparer = StringComparer.Ordinal; new List<string>().Sort(comparer);', 'CS1501']
  ];
  for (const [source, expected] of cases) {
    const result = compileToIL(prefix + source);
    assert.equal(result.success, false);
    assert.equal(result.image, null);
    assert(result.diagnostics.some(diagnostic => diagnostic.code === expected), JSON.stringify(result.diagnostics));
  }
});

test('registered comparer: semantic fallback leaves the legacy generic-syntax diagnostic intact', () => {
  const source = prefix + 'IComparer<string> comparer = StringComparer.Ordinal;';
  assert(parse(source).diagnostics.some(diagnostic => diagnostic.code === 'SF1012'));
  const result = compileToIL(source);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.equal(result.semantic?.generated, true);
});

test('registered comparer: object downcasts still require unsupported runtime type checks', () => {
  const result = compileToIL(prefix + `
    object value = StringComparer.Ordinal;
    IComparer<string> comparer = (IComparer<string>)value;
    Console.WriteLine(comparer.Compare("a", "b"));
  `);
  assert.equal(result.success, false);
  assert.equal(result.image, null);
  assert(result.diagnostics.some(diagnostic => diagnostic.code === 'SF2200'), JSON.stringify(result.diagnostics));
});
