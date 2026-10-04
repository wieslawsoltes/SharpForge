import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, decodeCoded } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus-store.js';
import { dotnetHost, sdkVersion, openDotnetScratch, runFixtureOnDotnet } from '../packages/compiler/test/differential/tools/dotnet-axis.mjs';

const prefix = `using System; using System.Runtime.CompilerServices;
[InlineArray(4)] struct Quad { private int first; }
`;

function emit(source) {
  const result = compileToAssembly(source, { name: 'InlineArrays' });
  assert.deepEqual(result.diagnostics.filter(row => row.severity === 'error'), []);
  const inspector = new AssemblyInspector(result.assembly);
  return {
    inspector,
    lines(name) {
      const method = inspector.types.find(type => type.name === 'Program')?.methods.find(candidate => candidate.name === name);
      assert.ok(method, name);
      return inspector.getMethod(method.token).instructions.map(instruction => {
        if (instruction.operandKind !== 'token' || instruction.operand >>> 24 === 0x70) return instruction.name;
        const token = instruction.operand;
        if ([1, 2, 27].includes(token >>> 24)) return `${instruction.name} ${inspector.metadata.typeName(token)}`;
        const target = inspector.resolveToken(token);
        return `${instruction.name} ${target.owner}::${target.name}`;
      });
    },
  };
}

test('A02-T80 direct CIL retains InlineArrayAttribute and constructs a view without allocating an array', () => {
  const { inspector, lines } = emit(`${prefix} class Program {
    static Span<int> View(ref Quad value) => value;
    static void Main() { Quad value = default; View(ref value)[1] = 7; Console.WriteLine(value[1]); }
  }`);
  const view = lines('View');
  assert.ok(view.some(line => line.endsWith('Unsafe::As')), view.join('\n'));
  assert.ok(view.some(line => line.endsWith('MemoryMarshal::CreateSpan')), view.join('\n'));
  assert.ok(!view.some(line => line.startsWith('newarr') || line.startsWith('ldobj')), 'view borrows the input');
  const metadata = inspector.metadata;
  const attributes = (metadata.rows[12] ?? []).map(row => {
    const constructor = decodeCoded('CustomAttributeType', row[1]);
    return metadata.typeName(decodeCoded('MemberRefParent', metadata.row(constructor)[0]));
  });
  assert.ok(attributes.includes('System.Runtime.CompilerServices.InlineArrayAttribute'));
});

test('A02-T80 a compound access evaluates its receiver and Index expression once', () => {
  const { lines } = emit(`${prefix} class Program {
    static Quad storage;
    static ref Quad Target() => ref storage;
    static Index Last() => ^1;
    static int Main() { Target()[Last()] += 7; return storage[^1]; }
  }`);
  const main = lines('Main');
  assert.equal(main.filter(line => line.endsWith('Program::Target')).length, 1);
  assert.equal(main.filter(line => line.endsWith('Program::Last')).length, 1);
  assert.ok(main.indexOf('call Program::Target') < main.indexOf('call Program::Last'));
  assert.ok(main.some(line => line.endsWith('System.Index::GetOffset')));
  assert.ok(main.includes('ldind.i4') && main.includes('stind.i4'));
});

test('A02-T80 readonly ranges call CreateReadOnlySpan and Slice', () => {
  const { lines } = emit(`${prefix} class Program {
    static ReadOnlySpan<int> Slice(in Quad value, Range range) => value[range];
    static void Main() { Quad value = default; Console.WriteLine(Slice(in value, 1..^1).Length); }
  }`);
  const body = lines('Slice');
  assert.equal(body.filter(line => line.endsWith('System.Index::GetOffset')).length, 2);
  assert.ok(body.some(line => line.endsWith('MemoryMarshal::CreateReadOnlySpan')));
  assert.ok(body.some(line => line.includes('ReadOnlySpan') && line.endsWith('::Slice')));
});

test('A02-T80 foreach bypasses custom enumerators and reads inline storage directly', () => {
  const { lines } = emit(`using System; using System.Runtime.CompilerServices;
    [InlineArray(2)] struct Buffer { private int first; public Enumerator GetEnumerator() => new Enumerator(); }
    struct Enumerator { public string Current => "custom"; public bool MoveNext() => false; }
    class Program { static void Main() { Buffer value = default; foreach (int item in value) Console.WriteLine(item); } }
  `);
  const main = lines('Main');
  assert.ok(main.some(line => line.endsWith('MemoryMarshal::CreateSpan')));
  assert.ok(!main.some(line => line.endsWith('::GetEnumerator')));
  assert.ok(main.includes('ldind.i4'));
});

const pack = loadReferencePack();
const dotnet = dotnetHost();
const sdk = pack ? sdkVersion(dotnet) : null;
const skip = !pack || !sdk ? 'a .NET SDK and reference pack are required' : false;

test('A02-T80 inline-array runtime values, aliasing, slices, generic managed elements and bounds', { skip }, t => {
  const fixture = {
    id: 'inline-array-regression',
    source: `${prefix}
      [InlineArray(3)] struct Row<T> { private T first; }
      class Program {
        static ReadOnlySpan<int> Read(in Quad value) => value;
        static Span<int> Write(ref Quad value) => value;
        static void Main() {
          Quad value = default;
          for (int i = 0; i < 4; i++) value[i] = i + 1;
          value[^1] += 10;
          Span<int> view = value;
          view[0] = 9;
          Range range = 1..^1;
          Span<int> middle = value[range];
          middle[1] = 20;
          ref int last = ref value[^1];
          last++;
          foreach (ref int item in value) item++;
          int sum = 0;
          foreach (int item in value) sum += item;
          Row<string> row = default;
          row[^1] = "end";
          ReadOnlySpan<string> names = row;
          Console.WriteLine($"{sum}:{value[0]},{value[1]},{value[2]},{value[3]}:{middle.Length}");
          Console.WriteLine($"{Read(in value)[^1]}:{Write(ref value)[0]}:{value[^0..].Length}:{value[..].Length}");
          Console.WriteLine($"{row[0] ?? "null"}:{names[^1]}:{names.Length}");
          int outside = 4;
          try { Console.WriteLine(value[outside]); } catch (IndexOutOfRangeException) { Console.WriteLine("index"); }
          Range reversed = 3..1;
          try { Console.WriteLine(value[reversed].Length); } catch (ArgumentOutOfRangeException) { Console.WriteLine("range"); }
        }
      }`,
  };
  const scratch = openDotnetScratch({ dotnet, sdk, pack });
  try {
    const expected = '50:10,3,21,16:2\n16:10:0:4\nnull:end:3\nindex\nrange\n';
    const result = runFixtureOnDotnet(fixture, { output: expected }, scratch.context('references'));
    assert.ok(result.ok, result.detail);
    t.diagnostic(`.NET SDK ${sdk}, reference pack ${pack.pack.version}; this expectation is not a Roslyn pin`);
  } finally {
    scratch.close();
  }
});

test('A02-T80 the existing pinned collection-expression stress fixture executes on real .NET', { skip }, t => {
  const fixture = loadFixtures().find(candidate => candidate.id === 'stress-language/collection-expressions');
  assert.ok(fixture, 'the stress regression remains present');
  const pin = loadPinned().results.get(fixture.id);
  assert.ok(pin, 'the Roslyn pin remains present');
  const scratch = openDotnetScratch({ dotnet, sdk, pack });
  try {
    const result = runFixtureOnDotnet(fixture, pin, scratch.context('references'));
    assert.ok(result.ok, result.detail);
    t.diagnostic(`existing Roslyn pin on .NET SDK ${sdk}, reference pack ${pack.pack.version}`);
  } finally {
    scratch.close();
  }
});
