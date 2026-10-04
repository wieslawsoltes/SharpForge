import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';

// SF-A02-T30, stress round 2 (second batch): binding defects found by the round-2 stress programs, checked here
// without a .NET SDK. What the programs print on real .NET is pinned from Roslyn 5.3.0 in the reduced programs named
// in each test (packages/compiler/test/differential/fixtures/reduced/, run by tests/compiler-stress-corpus.test.js).

const errorsOf = source =>
  analyze([parse(new SourceText(source, 'Program.cs'))], {})
    .diagnostics.filter(entry => entry.severity === 'error')
    .map(entry => entry.code);

/** The instructions of `type::method` as text: `opcode` or `opcode Owner::Member`. */
function instructionsOf(source, typeName, methodName) {
  const result = compileToAssembly(source, { name: 'Sample' }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly),
    type = inspector.types.find(candidate => candidate.name === typeName),
    method = type.methods.find(candidate => candidate.name === methodName);
  return inspector.getMethod(method.token).instructions.map(instruction => {
    if (instruction.operandKind !== 'token' || instruction.operand >>> 24 === 0x70) return instruction.name;
    const target = inspector.resolveToken(instruction.operand);
    return `${instruction.name} ${target.owner ?? ''}::${target.name}`;
  });
}

const currency = `struct Currency {
  public string Code;
  public static Currency Usd;
  public static implicit operator string(Currency c) => c.Code;
}`;

test('A02-T30 `Color Color` where there is no instance: a static member names the type (reduced-conversions/user-conversions-without-casts)', () => {
  const source = `enum Status { Empty, Open }
    ${currency}
    class Account {
      public Status Status { get; set; }
      public Currency Currency { get; set; }
      public static Status Initial = Status.Empty;
      public static Currency Default() => Currency.Usd;
      public Status Current() => Status == Status.Open ? Status.Open : Status;
    }`;
  assert.deepEqual(errorsOf(source), []);
  // An instance member that is not named after its type is still CS0120 from a static context.
  assert.deepEqual(errorsOf('class C { public int Count; public static int M() => Count.GetHashCode(); }'), ['CS0120']);
});

test('A02-T30 a switch statement governs on the one user-defined conversion to a switch type', () => {
  const source = `${currency}
    class P {
      static int Decimals(Currency c) { switch (c) { case "JPY": return 0; case "USD": return 2; default: return 3; } }
    }`;
  assert.deepEqual(errorsOf(source), []);
  const body = instructionsOf(`${source} class Q { static void Main() { } }`, 'P', 'Decimals');
  assert.ok(body.includes('call Currency::op_Implicit'), body.join('; '));
  // Two conversions to switch types: no conversion is chosen, and a string constant is not a pattern for the struct.
  const ambiguous = `struct Two { public static implicit operator string(Two t) => ""; public static implicit operator int(Two t) => 0; }
    class P { static int M(Two t) { switch (t) { case "a": return 1; default: return 0; } } }`;
  assert.notDeepEqual(errorsOf(ambiguous), []);
});

test('A02-T30 string concatenation converts an operand through its user-defined conversion to string', () => {
  const body = instructionsOf(`${currency} class P { static string Show(Currency c) => c + "!"; static void Main() { } }`, 'P', 'Show');
  assert.ok(body.includes('call Currency::op_Implicit'), body.join('; '));
  assert.ok(!body.some(name => name.startsWith('box')), body.join('; '));
});

test('A02-T30 `null` and tuple literals convert through an implicit operator of the target struct', () => {
  const declarations = `struct Tri {
      public static implicit operator Tri(bool value) => default;
      public static implicit operator Tri(bool? value) => default;
    }
    struct Vec {
      public static implicit operator Vec((double X, double Y) t) => default;
      public static bool operator ==(Vec a, Vec b) => true;
      public static bool operator !=(Vec a, Vec b) => false;
      public override bool Equals(object o) => true; public override int GetHashCode() => 0;
    }`;
  const uses = 'static void M(Tri t) { } static bool N(Vec v) { Tri a = null; M(null); Vec w = (1, 2); return v == (3.0, 4.0) && w != (1, 2); }';
  assert.deepEqual(errorsOf(`${declarations} class P { ${uses} }`), []);
  // A struct without such an operator still rejects null, and a tuple of the wrong shape does not convert.
  assert.deepEqual(errorsOf('struct S { } class P { static void N() { S s = null; } }'), ['CS0037']);
  assert.deepEqual(errorsOf(`${declarations} class P { static void N() { Vec w = (1, 2, 3); } }`), ['CS0029']);
});

test('A02-T30 tuples that differ only in inferred element names have a best common type (reduced-tuples/best-type-of-differently-named-tuples)', () => {
  const source = `class P { static int M(int unit, int i) {
      var cell = unit switch { 0 => (unit, i), 1 => (i, unit - 9), _ => (0, 0) };
      var (row, column) = unit > 3 ? (unit, i) : (i, unit);
      return cell.Item1 + row + column;
    } }`;
  assert.deepEqual(errorsOf(source), []);
});

test('A02-T30 a lifted comparison calls a user-defined operator only when both operands have a value', () => {
  const source = `struct M {
      public static bool operator <(M a, M b) => true; public static bool operator >(M a, M b) => true;
      public static bool operator ==(M a, M b) => true; public static bool operator !=(M a, M b) => false;
      public override bool Equals(object o) => true; public override int GetHashCode() => 0;
    }
    class P { static bool Less(M? a, M? b) => a < b; static bool Same(M? a, M? b) => a == b; static void Main() { } }`;
  const cases = [
    ['Less', 'op_LessThan'],
    ['Same', 'op_Equality'],
  ];
  for (const [method, operator] of cases) {
    const body = instructionsOf(source, 'P', method),
      call = body.indexOf(`call M::${operator}`),
      firstBranch = body.findIndex(name => /^(brfalse|bne)/.test(name));
    assert.ok(call > 0 && firstBranch > 0 && firstBranch < call, `${method}: ${body.join('; ')}`);
  }
});
