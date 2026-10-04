import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

// SF-A02-T30: what `base.` reaches when a member is overridden more than once. References: the corpus fixtures
// `base-access/*` are pinned against Roslyn 5.3.0 (the output fixture prints the pinned output on .NET 10.0.5, the
// diagnostics fixture matches by code, start and length).

function emit(source) {
  const result = compileToAssembly(source, { name: 'Sample' }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly);
  /** The calls of a method as `opcode Owner::Member`. */
  return (owner, name) => {
    const type = inspector.types.find(candidate => candidate.name === owner) ?? assert.fail(`no type ${owner}`),
      method = type.methods.find(candidate => candidate.name === name) ?? assert.fail(`no method ${owner}::${name}`);
    return inspector
      .getMethod(method.token)
      .instructions.filter(instruction => instruction.name === 'call' || instruction.name === 'callvirt')
      .map(instruction => {
        const target = inspector.resolveToken(instruction.operand);
        return `${instruction.name} ${target.owner}::${target.name}`;
      });
  };
}
const codesOf = source =>
  compileToAssembly(source, { name: 'Sample' })
    .diagnostics.filter(entry => entry.severity === 'error')
    .map(entry => entry.code);
const hierarchy = `using System;
  abstract class Shape { public abstract int Area(); public virtual string Name() { return "shape"; }
    public virtual int Value { get { return 1; } set { } } public virtual int this[int i] { get { return i; } } }
  class Square : Shape { public override int Area() { return 4; } public override string Name() { return "square"; }
    public override int Value { get { return 2; } set { } } public override int this[int i] { get { return i * 10; } } }
  class Middle : Square { }`;

test('A02-T30 base.M() calls the nearest override of the base classes, not the declaration', () => {
  const calls = emit(`${hierarchy}
    class Cube : Middle {
      public override int Area() { return base.Area(); }
      public override string Name() { return base.Name(); }
      public override int Value { get { return base.Value; } set { base.Value = value; } }
      public override int this[int i] { get { return base[i]; } }
    }
    class P { static void Main() { Console.WriteLine(new Cube().Name()); } }`);
  assert.deepEqual(calls('Cube', 'Area'), ['call Square::Area']);
  assert.deepEqual(calls('Cube', 'Name'), ['call Square::Name']);
  assert.deepEqual(calls('Cube', 'get_Value'), ['call Square::get_Value']);
  assert.deepEqual(calls('Cube', 'set_Value'), ['call Square::set_Value']);
  assert.deepEqual(calls('Cube', 'get_Item'), ['call Square::get_Item']);
});

test('A02-T30 base.M() without an override in between calls the declaration', () => {
  const calls = emit(`${hierarchy}
    class Other : Shape { public override int Area() { return 1; } public override string Name() { return base.Name() + base.ToString(); } }
    class P { static void Main() { Console.WriteLine(new Other().Name()); } }`);
  assert.deepEqual(calls('Other', 'Name'), ['call Shape::Name', 'call System.Object::ToString', 'call System.String::Concat']);
});

test('A02-T30 CS0205 only when the nearest override is abstract', () => {
  assert.deepEqual(codesOf(`${hierarchy} class Cube : Middle { public override int Area() { return base.Area(); } } class P { static void Main() { } }`), []);
  assert.deepEqual(codesOf(`${hierarchy} class Direct : Shape { public override int Area() { return base.Area(); } } class P { static void Main() { } }`), [
    'CS0205',
  ]);
  const reabstracted = `${hierarchy} abstract class Again : Square { public abstract override int Area(); }
    class Leaf : Again { public override int Area() { return base.Area(); } } class P { static void Main() { } }`;
  assert.deepEqual(codesOf(reabstracted), ['CS0205']);
});

test('A02-T30 an indexer that is overridden is found through the override', () => {
  assert.deepEqual(
    codesOf(`${hierarchy} class P { static void Main() { Square square = new Middle(); Console.WriteLine(square[2] + new Middle()[3]); } }`),
    [],
  );
});
