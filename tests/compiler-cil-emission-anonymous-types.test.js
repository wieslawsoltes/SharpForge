import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

// SF-A02-T30: anonymous types in direct CIL as the generic classes Roslyn declares
// (`<>f__AnonymousType0<<Name>j__TPar, <Age>j__TPar>`). Reference for the behaviour: the fixture
// `reference-fixtures/anonymous-types` of packages/compiler/test/cil-emission prints on .NET 10 what the Roslyn build
// prints, reflection included (verify-dotnet.mjs --references, SDK 10.0.201, reference pack 10.0.5), and the corpus
// fixtures `anonymous-types/*` run on .NET (tools/dotnet-axis.mjs).

function emit(source) {
  const result = compileToAssembly(source, { name: 'Sample' }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly),
    type = name => inspector.types.find(candidate => candidate.name === name) ?? assert.fail(`no type ${name}`);
  return {
    inspector,
    type,
    /** The instructions of a method as `name operand` lines; tokens are shown as `Owner::Member`. */
    lines(owner, name) {
      const method = type(owner).methods.find(candidate => candidate.name === name) ?? assert.fail(`no method ${owner}::${name}`);
      return inspector.getMethod(method.token).instructions.map(instruction => {
        if (instruction.operandKind !== 'token' || instruction.operand >>> 24 === 0x70) return instruction.name;
        const table = instruction.operand >>> 24;
        if (table === 1 || table === 2 || table === 27) return `${instruction.name} ${inspector.metadata.typeName(instruction.operand)}`;
        const target = inspector.resolveToken(instruction.operand);
        return `${instruction.name} ${target.owner}::${target.name}`;
      });
    },
  };
}
const anonymousTypes = inspector => inspector.types.filter(type => type.name.startsWith('<>f__AnonymousType')).map(type => type.name);
const main = body => `using System; class P { static void Main() { ${body} } }`;

test('A02-T30 an anonymous type is a generic class with a type parameter, a field and a getter per member', () => {
  const { inspector, type } = emit(main('var a = new { Name = "x", Age = 3 }; Console.WriteLine(a.Name + a.Age);'));
  assert.deepEqual(anonymousTypes(inspector), ['<>f__AnonymousType0`2']);
  const declared = type('<>f__AnonymousType0`2');
  assert.deepEqual(
    declared.methods.map(method => method.name),
    ['.ctor', 'get_Name', 'get_Age', 'Equals', 'GetHashCode', 'ToString'],
  );
  assert.deepEqual(
    declared.fields.map(field => field.name),
    ['<Name>i__Field', '<Age>i__Field'],
  );
  const metadata = inspector.metadata,
    parameters = (metadata.rows[42] ?? []).map(row => metadata.string(row[3]));
  assert.deepEqual(parameters, ['<Name>j__TPar', '<Age>j__TPar']);
});

test('A02-T30 creation evaluates the values in order and constructs the class over the member types', () => {
  const { lines } = emit(main('var a = new { Name = "x", Age = 3 }; Console.WriteLine(a.Age);'));
  const body = lines('P', 'Main');
  assert.deepEqual(body.slice(0, 3), ['ldstr', 'ldc.i4.3', 'newobj <>f__AnonymousType0`2<string, int>::.ctor'], body.join('; '));
  assert.ok(body.includes('callvirt <>f__AnonymousType0`2<string, int>::get_Age'), body.join('; '));
});

test('A02-T30 types with the same member names share one class; another order or other names get their own', () => {
  const { inspector, lines } = emit(
    main(`var a = new { A = 1, B = "s" }; var b = new { A = 2.5, B = 'c' }; var c = new { B = "s", A = 1 }; var d = new { };
      Console.WriteLine(a.ToString() + b + c + d);`),
  );
  assert.deepEqual(anonymousTypes(inspector), ['<>f__AnonymousType0`2', '<>f__AnonymousType1`2', '<>f__AnonymousType2']);
  const creations = lines('P', 'Main').filter(line => line.startsWith('newobj'));
  assert.deepEqual(creations, [
    'newobj <>f__AnonymousType0`2<int, string>::.ctor',
    'newobj <>f__AnonymousType0`2<double, char>::.ctor',
    'newobj <>f__AnonymousType1`2<string, int>::.ctor',
    'newobj <>f__AnonymousType2::.ctor',
  ]);
});

test('A02-T30 Equals compares the fields through EqualityComparer<T>.Default; ToString formats the members', () => {
  const { lines } = emit(main('var a = new { Name = "x", Age = 3 }; Console.WriteLine(a.Equals(a) + a.ToString());'));
  const equals = lines('<>f__AnonymousType0`2', 'Equals');
  assert.equal(equals.filter(line => /EqualityComparer`1<.*>::get_Default$/.test(line)).length, 2, equals.join('; '));
  assert.equal(equals.filter(line => /EqualityComparer`1<.*>::Equals$/.test(line)).length, 2);
  assert.ok(equals[1].startsWith('isinst <>f__AnonymousType0`2'));
  const text = lines('<>f__AnonymousType0`2', 'ToString');
  assert.equal(text.at(-2), 'call System.String::Format');
  assert.equal(text.filter(line => line === 'callvirt System.Object::ToString').length, 2);
  const hash = lines('<>f__AnonymousType0`2', 'GetHashCode');
  assert.equal(hash.filter(line => /EqualityComparer`1<.*>::GetHashCode$/.test(line)).length, 2);
});

test('A02-T30 an anonymous type over a type parameter follows the generic context, also in a closure class', () => {
  const { lines, inspector } = emit(`using System;
    class P {
      static string Show<T>(T value) { var pair = new { value, Twice = 2 }; Func<string> text = () => pair.ToString() + new { value }.value; return text(); }
      static void Main() { Console.WriteLine(Show(3)); }
    }`);
  assert.deepEqual(anonymousTypes(inspector), ['<>f__AnonymousType0`2', '<>f__AnonymousType1`1']);
  const creation = lines('P', 'Show').find(line => line.startsWith('newobj <>f__AnonymousType0'));
  assert.equal(creation, 'newobj <>f__AnonymousType0`2<!!0, int>::.ctor');
  const closure = inspector.types.find(type => type.name.includes('DisplayClass')) ?? assert.fail(inspector.types.map(type => type.name).join(', ')),
    lambda = closure.methods.find(method => method.name !== '.ctor'),
    inLambda = lines(closure.name, lambda.name).find(line => line.startsWith('newobj <>f__AnonymousType1'));
  // The closure class reads the method's `T` as its own type parameter.
  assert.equal(inLambda, 'newobj <>f__AnonymousType1`1<!0>::.ctor');
});

test('A02-T30 anonymous types nest and are elements of arrays and type arguments', () => {
  const { lines } = emit(
    main(`var n = new { Inner = new { V = 1 }, S = (string)null }; var items = new[] { new { K = 1 }, new { K = 2 } };
      Func<int, object> make = v => new { K = v }; Console.WriteLine(n.Inner.V + items[1].K + make(1).ToString());`),
  );
  const body = lines('P', 'Main');
  assert.ok(body.includes('newobj <>f__AnonymousType1`2<<>f__AnonymousType0`1<int>, string>::.ctor'), body.join('; '));
  assert.ok(body.includes('newarr <>f__AnonymousType2`1<int>'), body.join('; '));
});

test('A02-T30 the errors of anonymous object creation are unchanged', () => {
  const codes = source =>
    compileToAssembly(main(source), { name: 'Sample' })
      .diagnostics.filter(entry => entry.severity === 'error')
      .map(entry => entry.code);
  assert.deepEqual(codes('var a = new { 1 };'), ['CS0746']);
  assert.deepEqual(codes('var a = new { A = null };'), ['CS0828']);
  assert.deepEqual(codes('var a = new { A = 1, A = 2 };'), ['CS0833']);
  assert.deepEqual(codes('var a = new { A = 1 }; a.A = 2;'), ['CS0200']);
});
