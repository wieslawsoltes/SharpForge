import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileToAssembly } from '@sharpforge/compiler';
import { AssemblyInspector, decodeInstructions } from '@sharpforge/cil';
import { loadSymbols, readDebugDirectory, PdbGuids } from '@sharpforge/symbols';
import { IlBuilder } from '../packages/compiler/src/emit/cil/il-builder.js';

function compile(source, options = {}) {
  const result = compileToAssembly(source, { name: 'DebugSample', portablePdb: true, ...options });
  assert.equal(result.success, true, result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join('\n'));
  assert.ok(result.pdb instanceof Uint8Array, 'direct CIL returns a Portable PDB');
  return { result, pe: new AssemblyInspector(result.assembly), pdb: loadSymbols(result.assembly, result.pdb) };
}

const methodNamed = (pe, name) => pe.types.flatMap(type => type.methods).find(method => method.name === name);
const pointsOf = (pdb, token) => pdb.methods.find(method => method.token === token)?.points ?? [];

test('direct CIL source markers survive insertion and compact branch relaxation without emitting bytes', () => {
  const il = new IlBuilder();
  il.debug = {};
  const start = {};
  const end = il.newLabel();
  il.markDebug(start);
  il.emit('ldc.i4', 1).emit('pop').emit('br', end);
  il.mark(end);
  il.markDebug({});
  assert.equal(il.isJustPastLabel, true);
  il.emit('ret', undefined, { pops: 0, pushes: 0 });
  il.insert(0, [{ name: 'ldc.i4', operand: 2 }, { name: 'pop' }]);
  const body = il.assemble();
  assert.deepEqual(decodeInstructions(body.code).map(instruction => instruction.name), ['ldc.i4.2', 'pop', 'ldc.i4.1', 'pop', 'br.s', 'ret']);
  assert.equal(body.debugOffsets.get(start), 2);
  assert.equal(body.debugOffsets.get(end), 6);
});

test('direct CIL returns bound deterministic PDBs with exact source hashes and instruction boundaries', () => {
  const source = 'class P { static void Main() { int value = 1; if (value > 0) value++; System.Console.WriteLine(value); } }';
  const { result, pe, pdb } = compile(source);
  const token = methodNamed(pe, 'Main').token;
  const boundaries = new Set(pe.getMethod(token).instructions.map(instruction => instruction.offset));
  const points = pointsOf(pdb, token);
  assert.ok(points.filter(point => !point.hidden).length >= 3);
  assert.ok(points.every(point => boundaries.has(point.offset)));
  assert.deepEqual(pdb.documents[0].hash, new Uint8Array(createHash('sha256').update(source).digest()));
  assert.equal(pdb.bound, true);
  assert.deepEqual(compile(source).result.pdb, result.pdb);
  assert.deepEqual(compile(source).result.assembly, result.assembly);
});

test('enabling symbols preserves every emitted instruction, branch and exception clause', () => {
  const source = 'class P { static void Main() { int x = 1; loop: try { x++; } finally { x++; } if (x < 4) goto loop; } }';
  const { pe } = compile(source);
  const plain = compileToAssembly(source, { name: 'DebugSample', portablePdb: false });
  assert.equal(plain.success, true);
  assert.equal(plain.pdb, null);
  const without = new AssemblyInspector(plain.assembly);
  for (const method of pe.types.flatMap(type => type.methods).filter(method => method.rva)) {
    const actual = pe.getMethod(method.token);
    const expected = without.getMethod(method.token);
    assert.deepEqual(actual.instructions, expected.instructions);
    assert.deepEqual(actual.handlers, expected.handlers);
  }
});

test('zero-code and unreachable source constructs do not steal another statement sequence point', () => {
  const source = [
    'class P { static void Main() {', 'const int constant = 2;', ';',
    'System.Console.WriteLine(constant);', 'return;', 'System.Console.WriteLine(99);', '} }',
  ].join('\n');
  const { pe, pdb } = compile(source);
  const points = pointsOf(pdb, methodNamed(pe, 'Main').token).filter(point => !point.hidden);
  assert.deepEqual(points.map(point => point.startLine), [4, 5]);
});

test('lexical locals and constants use actual slots and nested block/loop/handler extents', () => {
  const source = `class P { static void Main() {
    int outer = 1;
    { int inner = outer + 1; System.Console.WriteLine(inner); }
    for (int index = 0; index < 2; index++) System.Console.WriteLine(index);
    try { throw new System.Exception(); } catch (System.Exception error) { System.Console.WriteLine(error.Message); }
    const string text = "constant";
    System.Console.WriteLine(outer);
  } }`;
  const { pe, pdb } = compile(source);
  const method = methodNamed(pe, 'Main');
  const tree = pdb.scopeTree(method.token);
  const all = [];
  const visit = scope => { all.push(scope); for (const child of scope.children) visit(child); };
  for (const root of tree) visit(root);
  const scope = name => all.find(entry => entry.locals.some(local => local.name === name));
  assert.ok(scope('outer'));
  for (const name of ['inner', 'index', 'error']) {
    assert.ok(scope(name), name);
    assert.ok(scope(name).start >= scope('outer').start);
    assert.ok(scope(name).end <= scope('outer').end);
    assert.ok(scope(name).end - scope(name).start < scope('outer').end - scope('outer').start);
  }
  assert.equal(pdb.constants.find(constant => constant.name === 'text').value, 'constant');
  assert.equal(all.flatMap(entry => entry.locals).some(local => local.name.startsWith('<')), false);
});

test('partial-type initializers retain their actual documents inside the same emitted method', () => {
  const inputs = [
    { uri: 'one.cs', text: 'partial class P { static int first = 1; static void Main() { System.Console.WriteLine(first + second); } }' },
    { uri: 'two.cs', text: 'partial class P { static int second = 2; }' },
  ];
  const { pe, pdb } = compile(inputs);
  const method = methodNamed(pe, '.cctor');
  const documents = pointsOf(pdb, method.token).filter(point => !point.hidden).map(point => pdb.documents[point.document - 1].name);
  assert.deepEqual(documents, ['one.cs', 'two.cs']);
});

test('constant scopes retain exact enum, decimal, wide integer and typed-null signatures', () => {
  const source = `enum Choice : short { Selected = -1234 }
class P { static void Main() {
  const Choice choice = Choice.Selected;
  const decimal amount = -123.4500m;
  const ulong limit = 18446744073709551615UL;
  const P missing = null;
  System.Console.WriteLine(1);
} }`;
  const { pe, pdb } = compile(source);
  const constants = new Map(pdb.constants.map(constant => [constant.name, constant]));
  assert.equal(constants.get('choice').value, -1234);
  assert.equal(constants.get('choice').enumTypeVerified, true);
  assert.equal(constants.get('amount').value, '-123.4500');
  assert.deepEqual(constants.get('amount').decimal, { coefficient: 1234500n, scale: 4, negative: true });
  assert.equal(constants.get('limit').value, 18446744073709551615n);
  assert.equal(constants.get('missing').value, null);
  assert.equal(constants.get('missing').typeToken, pe.types.find(type => type.name === 'P').token);
});

test('stackalloc stream replacement retains source points and exact local slots', () => {
  const source = `unsafe class P { static void Main() {
    int* values = stackalloc int[2] { 40, 2 };
    System.Console.WriteLine(values[0] + values[1]);
  } }`;
  const { pe, pdb } = compile(source, { allowUnsafe: true });
  const method = methodNamed(pe, 'Main');
  const body = pe.getMethod(method.token);
  const boundaries = new Set(body.instructions.map(instruction => instruction.offset));
  const points = pointsOf(pdb, method.token);
  assert.deepEqual(points.filter(point => !point.hidden).map(point => point.startLine), [2, 3]);
  assert.ok(points.every(point => boundaries.has(point.offset)));
  const variables = pdb.scopeTree(method.token).flatMap(scope => flattenScopes(scope).flatMap(entry => entry.locals));
  assert.ok(variables.some(variable => variable.name === 'values'));
});

test('constructor initializer points start before the receiver and cover complete stores and calls', () => {
  const source = `class Base { public Base(int value) { } }
class P : Base {
  int first = 40;
  int second = 2;
  P() : base(42) { }
  static void Main() { var value = new P(); System.Console.WriteLine(value.first + value.second); }
}`;
  const { pe, pdb } = compile(source);
  const method = pe.types.find(type => type.name === 'P').methods.find(method => method.name === '.ctor');
  const body = pe.getMethod(method.token);
  const instructions = new Map(body.instructions.map(instruction => [instruction.offset, instruction]));
  const points = pointsOf(pdb, method.token).filter(point => !point.hidden);
  assert.deepEqual(points.map(point => point.startLine), [3, 4, 5]);
  assert.ok(points.every(point => instructions.get(point.offset).name === 'ldarg.0'));
  const plain = compileToAssembly(source, { name: 'DebugSample', portablePdb: false });
  assert.deepEqual(body.instructions, new AssemblyInspector(plain.assembly).getMethod(method.token).instructions);
});

test('line mappings, hidden regions, reset paths and declared checksums are preserved without fabricated source', () => {
  const hash = '01020304';
  const source = `#pragma checksum "view.cs" "{${PdbGuids.sha256}}" "${hash}"
class P { static void Main() {
#line 120 "view.cs"
System.Console.WriteLine(1);
#line hidden
System.Console.WriteLine(2);
#line default
System.Console.WriteLine(3);
#line 200
System.Console.WriteLine(4);
#line 300 "unknown.cs"
System.Console.WriteLine(5);
} }`;
  const { pe, pdb } = compile([{ uri: 'physical.cs', text: source }]);
  const points = pointsOf(pdb, methodNamed(pe, 'Main').token);
  const visible = points.filter(point => !point.hidden);
  assert.deepEqual(visible.map(point => [pdb.documents[point.document - 1].name, point.startLine]), [
    ['view.cs', 120], ['physical.cs', 8], ['physical.cs', 200], ['unknown.cs', 300],
  ]);
  assert.ok(points.some(point => point.hidden));
  assert.deepEqual(pdb.documents.find(document => document.name === 'view.cs').hash, Uint8Array.of(1, 2, 3, 4));
  assert.equal(pdb.documents.find(document => document.name === 'unknown.cs').hashAlgorithm, null);
  assert.equal(pdb.custom.filter(record => record.kind === PdbGuids.embeddedSource).length, 1);
});

test('enhanced line directives map generated prefixes to the declared whole-span end', () => {
  const source = `class P { static void Main() {
#line (200, 5) - (201, 8) 8 "component.razor"
  System.Console.WriteLine(7);
#line default
} }`;
  const { pe, pdb } = compile(source);
  const points = pointsOf(pdb, methodNamed(pe, 'Main').token).filter(point => !point.hidden);
  assert.deepEqual(points.map(point => [point.startLine, point.startColumn, point.endLine, point.endColumn]), [[200, 5, 201, 9]]);
});

test('portable and embedded symbols are opt-in and explicit false suppresses both modes', () => {
  const sourceLink = { documents: { 'Program.cs': 'https://example.invalid/Program.cs' } };
  const { result, pdb } = compile('System.Console.WriteLine(1);', { embeddedPdb: true, embedSources: false, includeDebug: false, sourceLink });
  assert.ok(readDebugDirectory(result.assembly).some(entry => entry.kind === 17));
  assert.equal(loadSymbols(result.assembly).bound, true);
  assert.equal(pdb.custom.some(record => record.kind === PdbGuids.embeddedSource), false);
  assert.deepEqual(pdb.custom.find(record => record.kind === PdbGuids.sourceLink).sourceLink, sourceLink);
  const disabled = compileToAssembly('System.Console.WriteLine(1);', { portablePdb: false, embeddedPdb: true });
  assert.equal(disabled.success, true);
  assert.equal(disabled.pdb, null);
  assert.deepEqual(readDebugDirectory(disabled.assembly), []);
  const defaults = compileToAssembly('System.Console.WriteLine(1);');
  assert.equal(defaults.pdb, null);
  assert.deepEqual(readDebugDirectory(defaults.assembly), []);
  const embeddedOnly = compileToAssembly('System.Console.WriteLine(1);', { embeddedPdb: true });
  assert.ok(embeddedOnly.pdb instanceof Uint8Array);
  assert.equal(loadSymbols(embeddedOnly.assembly).bound, true);
});

test('diagnostic failures return no PDB and library symbols keep an empty entry point', () => {
  const failed = compileToAssembly('class P { static void Main() { int x = "bad"; } }');
  assert.equal(failed.success, false);
  assert.equal(failed.assembly, null);
  assert.equal(failed.pdb, null);
  const { pdb } = compile('public class C { public int Value() => 42; }', { outputKind: 'library' });
  assert.equal(pdb.entryPoint, 0);
  const oversized = `#pragma checksum "mapped.cs" "{${PdbGuids.sha256}}" "${'00'.repeat(4097)}"\nclass P { static void Main() { } }`;
  const rejected = compileToAssembly(oversized, { portablePdb: true });
  assert.equal(rejected.success, false);
  assert.equal(rejected.assembly, null);
  assert.equal(rejected.pdb, null);
  assert.ok(rejected.diagnostics.some(diagnostic => diagnostic.code === 'SF3001' && diagnostic.message.includes('4096')));
});

test('async and iterator links, await labels and hoisted-local ranges refer to emitted methods', () => {
  const source = `using System.Threading.Tasks; using System.Collections.Generic;
class P {
  static async Task<int> Add(Task<int> input) { int alive = 3; await input; return alive; }
  static async void Fire(Task input) { await input; }
  static IEnumerable<int> Items() { int alive = 1; yield return alive; alive++; yield return alive; }
  static void Main() { }
}`;
  const { pe, pdb } = compile(source);
  assert.equal(pdb.stateMachines.length, 3);
  for (const name of ['Add', 'Items']) {
    const kickoff = methodNamed(pe, name).token;
    const info = pdb.asyncInfo(kickoff);
    assert.equal(info.stateMachine.kickoff, kickoff);
    const body = pe.getMethod(info.stateMachine.moveNext);
    const boundaries = new Set(body.instructions.map(instruction => instruction.offset));
    assert.ok(pointsOf(pdb, info.stateMachine.moveNext).filter(point => !point.hidden).length > 0);
    assert.equal(info.steps.length, name === 'Add' ? 1 : 0);
    const stepping = pdb.custom.find(record => record.parent === info.stateMachine.moveNext && record.kind === PdbGuids.asyncSteps);
    if (name === 'Add') assert.equal(stepping.catchHandlerOffset, -1);
    for (const step of info.steps) {
      assert.ok(boundaries.has(step.yieldOffset));
      assert.ok(boundaries.has(step.resumeOffset));
      assert.equal(step.resumeMethod, info.stateMachine.moveNext);
    }
    const scopeRecord = pdb.custom.find(record => record.parent === info.stateMachine.moveNext && record.kind === PdbGuids.hoistedScopes);
    assert.ok(scopeRecord?.scopes.some(scope => scope.end > scope.start));
    const visibleScope = scopeRecord.scopes.find(scope => scope.end > scope.start);
    const hoisted = pdb.hoistedLocals(kickoff, visibleScope.start);
    assert.equal(hoisted.available, true, hoisted.reason);
    assert.ok(hoisted.locals.some(local => local.name === 'alive'));
    const ordinary = pdb.scopeTree(info.stateMachine.moveNext).flatMap(scope => flattenScopes(scope).flatMap(entry => entry.locals));
    assert.equal(ordinary.some(local => local.name === 'alive'), false);
  }
  const fire = pdb.asyncInfo(methodNamed(pe, 'Fire').token);
  const fireSteps = pdb.custom.find(record => record.parent === fire.stateMachine.moveNext && record.kind === PdbGuids.asyncSteps);
  const fireBody = pe.getMethod(fire.stateMachine.moveNext);
  assert.ok(fireBody.handlers.some(handler => handler.flags === 0 && handler.target === fireSteps.catchHandlerOffset));
  assert.equal(fire.steps.length, 1);
});

function flattenScopes(scope) {
  return [scope, ...scope.children.flatMap(flattenScopes)];
}
