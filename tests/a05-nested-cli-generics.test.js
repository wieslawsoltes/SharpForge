import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToAssembly} from '@sharpforge/compiler';
import {decodeCoded, readSourceTypeIdentities} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {runtimeTypeName} from '../packages/runtime/src/execution/method-table.js';

const source = `using System;
  namespace Sample {
    public class Outer<T> {
      public class Inner<U> {
        public T Left;
        public U Right;
        public Inner(T left, U right) { Left = left; Right = right; }
        public T ReadLeft() { return Left; }
        public U ReadRight() { return Right; }
      }
      public class Plain {
        public T Value;
        public Plain(T value) { Value = value; }
        public T Read() { return Value; }
      }
    }
  }
  class Program {
    static void Main() {
      var first = new Sample.Outer<int>.Inner<string>(17, "inner");
      first.Left = 23;
      var second = new Sample.Outer<string>.Inner<int>("outer", 19);
      second.Right = 29;
      Console.WriteLine(first.ReadLeft()); Console.WriteLine(first.ReadRight());
      Console.WriteLine(second.ReadLeft()); Console.WriteLine(second.ReadRight());
      var inherited = new Sample.Outer<int>.Plain(31); inherited.Value = 37;
      Console.WriteLine(inherited.Read());
      Console.WriteLine(new Sample.Outer<string>.Plain("inherited").Read());
    }
  }`;

function createVM() {
  const artifact = compileToAssembly(source);
  assert.equal(artifact.success, true, JSON.stringify(artifact.diagnostics));
  return new CilVirtualMachine(artifact.assembly);
}

test('actual CLI nested generic metadata counts inherited and introduced parameters', () => {
  const vm = createVM();
  try {
    assert.equal(readSourceTypeIdentities(vm.inspector.metadata).size, 0);
    for (const [name, arity] of [['Sample.Outer`1', 1], ['Sample.Outer`1+Inner`1', 2], ['Sample.Outer`1+Plain', 1]]) {
      const definition = vm.typeSystem.table(name);
      const parameters = vm.inspector.metadata.rows[42].filter(row => decodeCoded('TypeOrMethodDef', row[2]) === definition.token);
      assert.equal(parameters.length, arity);
      assert.equal(definition.genericArity, arity, name);
      assert.equal(definition.flags.genericDefinition, true, name);
      assert.equal(definition.containsGenericParameters, true, name);
      assert.equal(definition.sourceIdentity, null, 'Actual CLI metadata does not use source projection');
    }
    const first = vm.typeSystem.table('Sample.Outer`1+Inner`1<int, string>');
    const second = vm.typeSystem.table('Sample.Outer`1+Inner`1<string, int>');
    assert.equal(first.genericDefinition, second.genericDefinition);
    assert.notEqual(first, second);
    assert.equal(first.genericArity, 2);
    assert.deepEqual(first.typeArguments.map(type => type.name), ['System.Int32', 'System.String']);
    assert.deepEqual(first.fields.map(field => field.type.name), ['System.Int32', 'System.String']);
    assert.deepEqual(second.fields.map(field => field.type.name), ['System.String', 'System.Int32']);
    assert.equal(first.flags.genericDefinition, false);
    assert.equal(first.containsGenericParameters, false);
    assert.throws(() => vm.typeSystem.table('Sample.Outer`1+Inner`1<int>'), /argument count/);
  } finally { vm.stop(); }
});

test('nested types without introduced parameters retain enclosing substitutions through fields and calls', () => {
  const vm = createVM();
  try {
    assert.equal(runtimeTypeName('Sample.Outer`1+Plain<int>'), 'Sample.Outer`1+Plain<System.Int32>');
    const table = vm.typeSystem.table('Sample.Outer`1+Plain<int>');
    assert.equal(table.genericDefinition.name, 'Sample.Outer`1+Plain');
    assert.equal(table.genericArity, 1);
    assert.equal(table.fields[0].type.name, 'System.Int32');
    assert.equal(table.containsGenericParameters, false);
    assert.throws(() => vm.typeSystem.table('Sample.Outer`1+Plain<int, string>'), /argument count/);
    const outcome = vm.run();
    assert.equal(outcome.state, 'terminated', outcome.fault?.stack);
    assert.equal(outcome.output, '23\ninner\nouter\n29\n37\ninherited\n');
  } finally { vm.stop(); }
});
