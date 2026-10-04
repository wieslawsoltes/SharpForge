import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, decodeCoded } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

// SF-A02-T30: unsafe code in direct CIL - pointers, the fixed statement, sizeof and fixed-size buffers. Reference for
// the behaviour: the fixture `pointers-and-fixed` of packages/compiler/test/cil-emission prints on .NET 10 what the
// Roslyn build prints (verify-dotnet.mjs, SDK 10.0.201), and the corpus fixtures `unsafe-code/*` run on .NET
// (tools/dotnet-axis.mjs).

function emit(source) {
  const result = compileToAssembly(source, { name: 'Sample', allowUnsafe: true }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly),
    type = name => inspector.types.find(candidate => candidate.name === name) ?? assert.fail(`no type ${name}`);
  return {
    inspector,
    type,
    /** The instruction names of a method (pointer signatures are not resolved by the inspector). */
    names(owner, name) {
      const method = type(owner).methods.find(candidate => candidate.name === name) ?? assert.fail(`no method ${owner}::${name}`);
      return inspector.getMethod(method.token).instructions.map(instruction => instruction.name);
    },
  };
}

const codes = (source, options = { allowUnsafe: true }) =>
  compileToAssembly(source, { name: 'Sample', ...options })
    .diagnostics.filter(entry => entry.severity === 'error')
    .map(entry => entry.code);
const program = (body, declarations = '') => `using System; ${declarations} unsafe class P { ${body} }`;

test('A02-T30 the address of a variable is a native integer; a read and a write go through it', () => {
  const { names } = emit(program('static void Main() { int x = 1; int* p = &x; *p = *p + 2; Console.WriteLine(x); }'));
  const body = names('P', 'Main');
  assert.deepEqual(body.slice(2, 5), ['ldloca.s', 'conv.u', 'stloc.1'], body.join('; '));
  assert.ok(body.includes('ldind.i4') && body.includes('stind.i4'));
});

test('A02-T30 pointer arithmetic scales by the element size; a difference is divided by it', () => {
  const { names } = emit(
    program(`static long* Move(long* p, int n) { return p + n; }
      static long Distance(long* a, long* b) { return a - b; }
      static bool Before(int* a, int* b) { return a < b; }
      static void Main() { }`),
  );
  assert.deepEqual(names('P', 'Move'), ['ldarg.0', 'ldarg.1', 'conv.i', 'ldc.i4.8', 'mul', 'add', 'ret']);
  assert.deepEqual(names('P', 'Distance'), ['ldarg.0', 'ldarg.1', 'sub', 'ldc.i4.8', 'div', 'conv.i8', 'ret']);
  assert.deepEqual(names('P', 'Before'), ['ldarg.0', 'ldarg.1', 'clt.un', 'ret']);
});

test('A02-T30 a member of the struct a pointer designates is reached in place', () => {
  const { names } = emit(program('static void Set(Point* p) { p->Y = 5; p[1].X = 6; } static void Main() { }', 'struct Point { public int X; public int Y; }'));
  const body = names('P', 'Set');
  // No copy of the struct: the pointer itself is the receiver of `stfld`.
  assert.deepEqual(body.slice(0, 3), ['ldarg.0', 'ldc.i4.5', 'stfld'], body.join('; '));
  assert.ok(!body.includes('ldobj') && !body.some(name => name.startsWith('stloc')));
});

test('A02-T30 fixed pins an array through a pinned local and unpins it after the body', () => {
  const { inspector, names, type } = emit(
    program('static int First(int[] a) { fixed (int* p = a) { return *p; } } static void Main() { Console.WriteLine(First(new[] { 3 })); }'),
  );
  const body = names('P', 'First');
  assert.ok(body.includes('ldelema') && body.includes('conv.u'), body.join('; '));
  const method = type('P').methods.find(candidate => candidate.name === 'First'),
    signature = inspector.metadata.blob(inspector.metadata.row(inspector.getMethod(method.token).localSignature)[0]);
  // LOCAL_SIG: one of the locals is `pinned int32[]` (0x45 0x1d 0x08).
  assert.ok([...signature].join(',').includes('69,29,8'), [...signature].join(','));
});

test('A02-T30 sizeof of a predefined type is a constant, of a struct the sizeof instruction', () => {
  const { names } = emit(
    program(
      'static int A() { return sizeof(long); } static int B() { return sizeof(Point); } static void Main() { }',
      'struct Point { public int X; public int Y; }',
    ),
  );
  assert.deepEqual(names('P', 'A'), ['ldc.i4.8', 'ret']);
  assert.deepEqual(names('P', 'B'), ['sizeof', 'ret']);
});

test('A02-T30 a fixed-size buffer is a nested struct of the buffer size with a FixedBuffer attribute on the field', () => {
  const { inspector } = emit(
    program(
      'static void Main() { Packet packet = new Packet(); packet.Data[1] = 2; Console.WriteLine(packet.Data[1] + sizeof(Packet)); }',
      'unsafe struct Packet { public fixed int Data[4]; public int Length; }',
    ),
  );
  const buffer = inspector.types.find(candidate => candidate.name.endsWith('<Data>e__FixedBuffer')) ?? assert.fail(inspector.types.map(t => t.name).join()),
    metadata = inspector.metadata;
  assert.deepEqual(
    buffer.fields.map(field => field.name),
    ['FixedElementField'],
  );
  const layout = (metadata.rows[15] ?? []).find(row => row[2] === (buffer.token & 0xffffff));
  assert.equal(layout?.[1], 16, 'ClassLayout size is 4 elements of 4 bytes');
  const attributes = (metadata.rows[12] ?? []).map(row => {
    const constructor = decodeCoded('CustomAttributeType', row[1]);
    return metadata.typeName(decodeCoded('MemberRefParent', metadata.row(constructor)[0]));
  });
  for (const name of ['FixedBufferAttribute', 'UnsafeValueTypeAttribute']) {
    assert.ok(attributes.includes('System.Runtime.CompilerServices.' + name), `${name}: ${attributes.join(', ')}`);
  }
});

test('A02-T30 a fixed-size buffer of a generic struct is refused, never misnamed', () => {
  const result = compileToAssembly(
    `unsafe struct Box<T> { public fixed int Data[2]; public T Value; }
     unsafe class P { static void Main() { Box<int> box = new Box<int>(); box.Data[0] = 1; System.Console.WriteLine(box.Data[0]); } }`,
    { name: 'Sample', allowUnsafe: true },
  );
  assert.equal(result.assembly, null);
  assert.deepEqual(
    result.diagnostics.filter(entry => entry.severity === 'error').map(entry => entry.code),
    ['SF2200'],
  );
});

test('A02-T30 the diagnostics of unsafe code are unchanged', () => {
  assert.deepEqual(codes('class P { static void Main() { int x = 1; int* p = &x; } }'), ['CS0214', 'CS0214']);
  assert.deepEqual(codes('unsafe class P { static void Main() { } }', {}), ['CS0227']);
  assert.deepEqual(codes(program('static void Main() { int[] a = { 1 }; int* p = &a[0]; }')), ['CS0212']);
  assert.deepEqual(codes(program('static void Main() { void* p = null; p++; }')), ['CS0242']);
});
