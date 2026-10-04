import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly, AssemblyInspector} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

function execute(source, expected) {
  const compiled = compileToIL('using System; ' + source);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  for (const [route, create] of [
    ['source', () => new VirtualMachine(compiled.image)],
    ['reloaded source', () => new VirtualMachine(loadAssembly(compiled.assembly))],
    ['direct CIL', () => new CilVirtualMachine(compiled.assembly)]
  ]) {
    const vm = create();
    const result = vm.run();
    assert.equal(result.state, 'terminated', route + ': ' + result.fault?.stack);
    assert.equal(result.fault, null, route + ': ' + result.fault?.message);
    assert.equal(result.output, expected, route);
  }
  return compiled;
}

test('Nullable scalar boxing emits null or the exact underlying value across all source routes', () => {
  const compiled = execute(`class Program {
    static void Main() {
      int? missing = null;
      object empty = missing;
      Console.WriteLine(empty == null ? "null" : "wrong");
      int? present = 7;
      object boxed = present;
      Console.WriteLine((int)boxed);
      Console.WriteLine(((int?)boxed).Value);
      Console.WriteLine(((int?)empty).HasValue ? 1 : 0);
      object wrong = 7L;
      try { int? rejected = (int?)wrong; Console.WriteLine(rejected.Value); }
      catch (InvalidCastException) { Console.WriteLine("type"); }
    }
  }`, 'null\n7\n7\n0\ntype\n');
  const inspector = new AssemblyInspector(compiled.assembly);
  assert([...inspector.methods.values()].some(method => inspector.getMethod(method.token).instructions
    .some(instruction => instruction.name === 'box')));
});

test('Nullable locals, fields, statics and arrays retain empty defaults and exact Value faults', () => {
  execute(`class Holder { public int? Value; }
  class Program {
    static int? Saved;
    static int? Empty() { return default(int?); }
    static void Main() {
      Holder holder = new Holder();
      int?[] values = new int?[2];
      Console.WriteLine(holder.Value.HasValue ? 1 : 0);
      Console.WriteLine(Saved.GetValueOrDefault(11));
      Console.WriteLine(values[0].GetValueOrDefault());
      values[1] = new int?(9);
      Console.WriteLine(values[1].Value);
      Console.WriteLine(Empty().GetValueOrDefault(13));
      try { Console.WriteLine(values[0].Value); }
      catch (InvalidOperationException) { Console.WriteLine("empty"); }
    }
  }`, '0\n11\n0\n9\n13\nempty\n');
});

test('Nullable struct copying and boxing isolate nested value storage', () => {
  execute(`struct Counter { public int Value; public Counter(int value) { Value = value; } }
  class Program {
    static void Main() {
      Counter value = new Counter(5);
      Counter? original = value;
      Counter? copy = original;
      object boxed = original;
      value.Value = 8;
      Counter extracted = copy.Value;
      extracted.Value = 12;
      Console.WriteLine(original.Value.Value);
      Console.WriteLine(((Counter)boxed).Value);
      Console.WriteLine(extracted.Value);
      Console.WriteLine(default(Counter?).GetValueOrDefault().Value);
    }
  }`, '5\n5\n12\n0\n');
});

test('Nullable numeric conversions preserve empty values and explicit unwrap exceptions', () => {
  execute(`class Program {
    static void Main() {
      int? small = 7;
      long? wide = small;
      Console.WriteLine(wide.Value);
      int? empty = null;
      long? absent = empty;
      Console.WriteLine(absent.HasValue ? 1 : 0);
      Console.WriteLine((int)small);
      try { Console.WriteLine((int)empty); }
      catch (InvalidOperationException) { Console.WriteLine("empty"); }
    }
  }`, '7\n0\n7\nempty\n');
});

test('Nullable constructors retain argument type and arity diagnostics', () => {
  for (const expression of ['new int?("wrong")', 'new int?(1, 2)']) {
    const compiled = compileToIL('class Program { static void Main() { int? value = ' + expression + '; } }');
    assert.equal(compiled.success, false, expression);
    assert(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error' && /^CS/.test(diagnostic.code)), expression);
  }
});
