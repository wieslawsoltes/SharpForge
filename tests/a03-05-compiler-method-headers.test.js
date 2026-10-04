import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly, compileToReferenceAssembly } from '@sharpforge/compiler';
import { AssemblyInspector, readMethodHeader, assembleILDocument, formatILDocument } from '@sharpforge/cil';
import { IlBuilder } from '../packages/compiler/src/emit/cil/il-builder.js';
import { rewriteHoistedSlots } from '../packages/compiler/src/emit/cil/state-machine-hoisting.js';

const done = { pops: 0, pushes: 0 };
const value = { pops: 1, pushes: 0 };

function compiled(source, options = {}) {
  const result = compileToAssembly(source, { name: 'Headers', outputKind: 'library', allowUnsafe: true, ...options });
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return new AssemblyInspector(result.assembly);
}

test('direct compiler chooses tiny for small no-local methods and fat for initialization-sensitive stackalloc', () => {
  const inspector = compiled(`public class Headers {
    public static int Identity(int value) { return value; }
    public static void Empty() { }
    public static unsafe int Allocate() { byte* p = stackalloc byte[4]; p[0] = 5; return p[0]; }
    public static int Protected(int value) { try { return 30 / value; } catch { return 7; } }
  }`);
  const method = name => [...inspector.methods.values()].find(item => item.name === name);
  for (const name of ['Identity', 'Empty']) {
    const header = readMethodHeader(inspector.pe, method(name).token);
    assert.equal(header.headerSize, 1, name);
    assert.equal(header.maxStack, 8, 'tiny reports its implicit bound, independently of the smaller exact peak');
  }
  const allocated = readMethodHeader(inspector.pe, method('Allocate').token);
  assert.equal(allocated.headerSize, 12);
  assert.equal(allocated.initLocals, true);
  const protectedBody = inspector.pe.methodBody(method('Protected').token);
  assert.equal(protectedBody.headerSize, 12);
  assert.equal(protectedBody.maxStack, 2);
  assert.ok(protectedBody.handlers.length > 0);
});

test('final compiler analysis removes cumulative insertion estimates and covers hoisted field rewrites', () => {
  const il = new IlBuilder();
  il.emit('ldc.i4', 1).emit('pop').emit('ret', undefined, done);
  il.insert(0, [{ name: 'ldc.i4', operand: 2 }, { name: 'pop' }]);
  il.insert(0, [{ name: 'ldc.i4', operand: 3 }, { name: 'pop' }]);
  assert.equal(il.maxDepth, 3);
  assert.equal(il.assemble().maxStack, 1);
  const rewritten = new IlBuilder();
  const local = rewritten.declareLocal({ name: 'int' });
  rewritten.emit('ldc.i4', 4).emit('stloc', local).emit('ldloc', local).emit('ret', undefined, value);
  rewriteHoistedSlots(rewritten, new Map([[local, 0x04000001]]));
  assert.equal(rewritten.assemble().maxStack, 2);
});

test('final relaxed offsets preserve variable effects after compact integers, locals and prefixed calls', () => {
  const il = new IlBuilder();
  const target = il.newLabel();
  il.emit('ldc.i4', 1).emit('brtrue', target).emit('ldc.i4', 2).emit('pop').mark(target);
  il.emit('ldnull').emit('constrained.', 0x01000001).emit('callvirt', 0x0a000001, { pops: 1, pushes: 1 })
    .emit('ret', undefined, value);
  const body = il.assemble();
  assert.equal(body.maxStack, 1);
  assert.ok(body.code.includes(0x2d), 'brtrue was relaxed');
  const broken = new IlBuilder().emit('ret', undefined, done);
  broken.insert(0, [{ name: 'pop' }]);
  assert.throws(() => broken.assemble(), error => error.name === 'IlBuilderError' && /underflow/.test(error.message));
});

test('reference output keeps throw-null contract and IL-document no-change keeps chosen header bytes', () => {
  const source = 'public class Contract { public int Value() { return 42; } private int Hidden() { return 7; } }';
  const result = compileToReferenceAssembly(source, { name: 'Contract', refout: true });
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  const inspector = new AssemblyInspector(result.assembly);
  assert.equal([...inspector.methods.values()].some(method => method.name === 'Hidden'), false);
  for (const method of inspector.methods.values()) {
    if (method.rva) assert.deepEqual(inspector.getMethod(method.token).instructions.map(instruction => instruction.name), ['ldnull', 'throw']);
  }
  assert.deepEqual(assembleILDocument(formatILDocument(result.assembly)).bytes, result.assembly);
  const direct = compiled('public class Small { public static int Value() { return 42; } }');
  assert.deepEqual(assembleILDocument(formatILDocument(direct.pe.bytes)).bytes, direct.pe.bytes);
});
