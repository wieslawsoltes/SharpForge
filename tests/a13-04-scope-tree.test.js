import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MetadataBuilder, readMetadata, encodeSignature, writeMethodBody } from '@sharpforge/cil';
import { loadSymbols, readPortablePdb } from '@sharpforge/symbols';
import { PortablePdbBuilder } from '../packages/symbols/src/pdb-builder.js';
import { createScopeTree } from '../packages/symbols/src/scope-tree.js';
import { bindLocalTypes } from '../packages/symbols/src/local-types.js';

const method = 0x06000001;
const primitive = { kind: 'primitive', name: 'int' };
function scope(id, start, end, variables = []) {
  return { id, start, end, methodToken: method, importScope: 0, variables, constants: [] };
}
function local(index = 0, name = 'local', hidden = false) {
  return { id: index + 1, index, name, hidden, attributes: hidden ? 1 : 0 };
}
function fixture(types = [primitive], scopes = [scope(1, 0, 10, [local()])]) {
  const builder = new MetadataBuilder('Locals');
  const signature = builder.add(17, [builder.blob(encodeSignature({ kind: 'locals', types }))]);
  builder.add(6, [1, 0, 0x16, builder.string('Method'), 0, 1]);
  const metadata = readMetadata(builder.finish());
  const bytes = writeMethodBody(new Uint8Array(10), signature, 1);
  const pe = {
    metadata,
    bytes,
    sections: [{ offset: 0, size: bytes.length }],
    offsetOf(rva, size = 1) {
      const at = rva - 1;
      if (at < 0 || at + size > pe.bytes.length) throw Error('Authored method extent');
      return at;
    },
    setLocalSignature(token) {
      new DataView(pe.bytes.buffer, pe.bytes.byteOffset).setUint32(8, token, true);
    },
  };
  const symbols = { scopes, methods: [{ token: method, localSignature: signature & 0xffffff }] };
  return { pe, symbols, lookup: createScopeTree(scopes, 1), signature };
}

function projectScope({ locals, children, ...scope }) {
  return {
    ...scope,
    locals: locals.map(({ type, typeReason, ...local }) => local),
    children: children.map(projectScope),
  };
}

test('native lexical tree and local signatures match SRM children and DecodeLocalSignature', () => {
  const directory = new URL('./fixtures/portable-pdb-scope-tree/', import.meta.url);
  const reference = JSON.parse(readFileSync(new URL('reference.json', directory), 'utf8'));
  const assembly = new Uint8Array(readFileSync(new URL('ScopeTree.dll', directory)));
  const pdb = new Uint8Array(readFileSync(new URL('ScopeTree.pdb', directory)));
  const symbols = loadSymbols(assembly, pdb);
  const tree = symbols.scopeTree(reference.native.method);
  assert.deepEqual(tree.map(projectScope), reference.native.roots);
  assert.equal(tree[0].children.length, 2);
  assert.equal(tree[0].children[0].children.length, 1);
  assert.equal(tree[0].children[0].locals.find((entry) => entry.name === 'items').type.kind, 'genericInstance');
  const standalone = readPortablePdb(pdb).scopeTree(reference.native.method);
  assert(standalone[0].locals.every((entry) => entry.type === null && entry.typeReason === 'type-metadata-required'));
  symbols.scopes.length = 0;
  symbols.variables[0].name = 'Changed';
  symbols.metadata.rows[50].length = 0;
  tree[0].children[0].locals[0].type.kind = 'Changed';
  assert.deepEqual(symbols.scopeTree(reference.native.method).map(projectScope), reference.native.roots);
});

test('hidden locals, constant row ids, equal ranges, disjoint roots and slot reuse are preserved', () => {
  const scopes = [scope(1, 0, 10, [local(0, 'outer')]), scope(2, 0, 10, [local(0, 'inner', true)]), scope(3, 10, 20)];
  scopes[1].constants.push({ id: 7 });
  const lookup = createScopeTree(scopes, 2);
  const tree = lookup(method);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].children[0].locals[0].compilerGenerated, true);
  assert.deepEqual(tree[0].children[0].constantIds, [7]);
  scopes[1].variables[0].name = 'Changed';
  tree[0].children.length = 0;
  assert.equal(lookup(method)[0].children[0].locals[0].name, 'inner');
  assert.deepEqual(lookup(method + 1), []);
  for (const invalid of [0, method - 1, method + 2, method + 0.5, method + 2 ** 32, NaN]) {
    assert.throws(() => lookup(invalid), /method token/);
  }
});

test('local binding owns exact byref/pinned/generic-parameter ASTs and fresh results', () => {
  const type = {
    kind: 'pinned',
    element: { kind: 'byref', element: { kind: 'genericParameter', scope: 'method', index: 0 } },
  };
  const { pe, symbols, lookup } = fixture([type]);
  const bound = bindLocalTypes(lookup, pe, symbols).scopeTree;
  assert.deepEqual(bound(method)[0].locals[0].type, type);
  assert.equal(bound(method)[0].locals[0].typeName, '!!0& pinned');
  assert.equal(bound(method)[0].locals[0].typeReason, null);
  const output = bound(method);
  output[0].locals[0].type.element.element.index = 99;
  pe.metadata.rows[17].length = 0;
  symbols.methods.length = 0;
  assert.deepEqual(bound(method)[0].locals[0].type, type);
});

test('absent sequence-point rows use the PE local signature; nil signatures are explicit', () => {
  const { pe, symbols, lookup } = fixture();
  symbols.methods = [];
  assert.equal(bindLocalTypes(lookup, pe, symbols).scopeTree(method)[0].locals[0].typeName, 'int');
  pe.setLocalSignature(0);
  const missing = bindLocalTypes(lookup, pe, symbols).scopeTree(method)[0].locals[0];
  assert.equal(missing.type, null);
  assert.equal(missing.typeReason, 'missing-local-signature');
});

test('bad slot, nonlocal signature, invalid token and signature limits fail before expansion', () => {
  const badSlot = fixture([primitive], [scope(1, 0, 10, [local(1)])]);
  assert.throws(() => bindLocalTypes(badSlot.lookup, badSlot.pe, badSlot.symbols), /outside its signature/);
  const state = fixture();
  state.pe.metadata.blob = () => new Uint8Array([6, 8]);
  assert.throws(() => bindLocalTypes(state.lookup, state.pe, state.symbols), /Expected local/);
  state.pe.metadata.blob = () => new Uint8Array(4097);
  assert.throws(() => bindLocalTypes(state.lookup, state.pe, state.symbols), /signature byte limit/);
  state.symbols.methods = [];
  state.pe.setLocalSignature(0x06000001);
  assert.throws(() => bindLocalTypes(state.lookup, state.pe, state.symbols), /signature token/);
  const many = fixture();
  many.symbols.scopes = Array.from({ length: 33 }, (_, index) => ({
    ...scope(index + 1, 0, 10, [local()]),
    methodToken: method + index,
  }));
  many.symbols.methods = Array.from({ length: 33 }, (_, index) => ({ localSignature: index + 1 }));
  many.pe.metadata.counts[17] = 33;
  many.pe.metadata.counts[6] = 33;
  const bodySize = many.pe.bytes.length;
  many.pe.bytes = new Uint8Array(bodySize * 33);
  many.pe.sections[0].size = many.pe.bytes.length;
  for (let index = 0; index < 33; index++) {
    many.pe.bytes.set(writeMethodBody(new Uint8Array(10), 0x11000001 + index, 1), index * bodySize);
  }
  many.pe.metadata.row = (token) => (token >>> 24 === 6 ? [1 + ((token & 0xffffff) - 1) * bodySize, 0] : [1]);
  many.pe.metadata.blob = () => new Uint8Array(4096);
  assert.throws(() => bindLocalTypes(many.lookup, many.pe, many.symbols), /signature byte limit/);
});

test('linear scope construction rejects ordering/overlap and bounds maximum nesting and entries', () => {
  assert.throws(() => createScopeTree([scope(1, 0, 5), scope(2, 3, 7)], 1), /overlapping/);
  assert.throws(() => createScopeTree([scope(1, 3, 7), scope(2, 0, 5)], 1), /Unsorted/);
  const scopes = Array.from({ length: 256 }, (_, index) => scope(index + 1, index, 1024 - index));
  assert.equal(createScopeTree(scopes, 1)(method).length, 1);
  assert.throws(() => createScopeTree([...scopes, scope(257, 256, 768)], 1), /depth limit/);
  assert.throws(() => createScopeTree({ length: 100001 }, 1), /entry limit/);
  assert.throws(() => createScopeTree([scope(1, 0, 1, { length: 100000 })], 1), /entry limit/);
});

test('PDB local names are bounded before tree snapshots, including overlapping heap offsets', () => {
  const builder = new PortablePdbBuilder();
  builder.add(51, [1, 0, builder.string('x'.repeat(3073))]);
  builder.add(50, [1, 0, 1, 1, 0, 1]);
  assert.throws(() => readPortablePdb(builder.finish({ 6: 1 }, 0).bytes), /name exceeds/);
  const aggregate = new PortablePdbBuilder();
  const name = aggregate.string('x'.repeat(1024));
  for (let index = 0; index < 1025; index++) aggregate.add(51, [0, index, name]);
  assert.throws(() => readPortablePdb(aggregate.finish({ 6: 1 }, 0).bytes), /name limit/);
});

test('oversized PDB local-signature RIDs cannot alias valid StandAloneSig tokens', () => {
  const { pe, symbols, lookup } = fixture();
  for (const signature of [0x01000001, 0x11000001, 2, -1, 1.5]) {
    symbols.methods[0].localSignature = signature;
    assert.throws(() => bindLocalTypes(lookup, pe, symbols), /local signature/);
  }
});
