import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

// SF-A02-T30: the interpolated string handler pattern (C# 10) in direct CIL. Reference for the behaviour: the
// fixture `interpolated-string-handlers` of packages/compiler/test/cil-emission prints on .NET 10 what the Roslyn
// build prints (verify-dotnet.mjs, SDK 10.0.201), and the corpus fixtures `interpolated-string-handlers/*` run on
// .NET (tools/dotnet-axis.mjs).

const handler = (kind, members) => `using System; using System.Runtime.CompilerServices;
  [InterpolatedStringHandler] ${kind} H { ${members} }`;
const plainMembers = `public H(int literalLength, int formattedCount) { }
  public void AppendLiteral(string value) { } public void AppendFormatted<T>(T value) { }`;

function linesOfMain(source) {
  const result = compileToAssembly(source, { name: 'Sample' }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly),
    type = inspector.types.find(candidate => candidate.name === 'P'),
    method = type.methods.find(candidate => candidate.name === 'Main');
  return inspector.getMethod(method.token).instructions.map(instruction => {
    if (instruction.operandKind !== 'token' || instruction.operand >>> 24 === 0x70) return instruction.name;
    const target = inspector.resolveToken(instruction.operand);
    return `${instruction.name} ${target.owner}::${target.name}`;
  });
}

test('A02-T30 a handler conversion constructs the handler with the counts and appends each part in order', () => {
  const body = linesOfMain(`${handler('class', plainMembers)}
    class P { static void Main() { int n = 3; H h = $"a {n} b"; Console.WriteLine(h != null); } }`);
  const calls = body.filter(line => /^(newobj|callvirt|call) H(`\d)?::/.test(line) || /^callvirt H::/.test(line));
  assert.deepEqual(calls, ['newobj H::.ctor', 'callvirt H::AppendLiteral', 'callvirt H::AppendFormatted', 'callvirt H::AppendLiteral'], body.join('; '));
  // literalLength 4 ("a " + " b") and formattedCount 1 are the constructor's arguments.
  const creation = body.indexOf('newobj H::.ctor');
  assert.deepEqual(body.slice(creation - 2, creation), ['ldc.i4.4', 'ldc.i4.1']);
});

test('A02-T30 a struct handler is appended to through the address of its temporary', () => {
  const body = linesOfMain(`${handler('struct', plainMembers)}
    class P { static void Main() { H h = $"a {1}"; Console.WriteLine(h.GetHashCode()); } }`);
  const first = body.indexOf('call H::AppendLiteral');
  assert.ok(first > 0, body.join('; '));
  assert.match(body[first - 2], /^ldloca/);
});

test('A02-T30 an out-bool constructor guards the appending; bool appends end it at the first false', () => {
  const members = `public H(int literalLength, int formattedCount, out bool enabled) { enabled = true; }
    public bool AppendLiteral(string value) { return true; } public bool AppendFormatted(int value) { return false; }`;
  const body = linesOfMain(`${handler('class', members)}
    class P { static int Next() { return 1; } static void Main() { H h = $"a {Next()} b"; Console.WriteLine(h != null); } }`);
  const creation = body.indexOf('newobj H::.ctor'),
    branches = body.filter(line => line.startsWith('brfalse'));
  // The flag is a local passed by address; one branch for the flag and one per appending call.
  assert.match(body[creation - 1], /^ldloca/);
  assert.equal(branches.length, 4, body.join('; '));
  assert.ok(body.indexOf('call P::Next') > body.findIndex(line => line.startsWith('brfalse')), 'the hole is evaluated behind the flag');
});

test('A02-T30 the diagnostics of a malformed handler pattern are unchanged', () => {
  const codes = members =>
    compileToAssembly(`${handler('class', members)} class P { static void Main() { H h = $"a {1}"; } }`, { name: 'Sample' })
      .diagnostics.filter(entry => entry.severity === 'error')
      .map(entry => entry.code);
  assert.deepEqual(codes('public H(int literalLength, int formattedCount) { } public void AppendLiteral(string value) { }'), ['CS1061', 'CS8941']);
  assert.deepEqual(
    codes(
      'public H(int literalLength, int formattedCount) { } public void AppendLiteral(string value) { } public int AppendFormatted(int value) { return 0; }',
    ),
    ['CS8941'],
  );
});
