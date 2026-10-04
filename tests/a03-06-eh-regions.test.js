import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildExceptionRegionTree, exceptionRegionDiagnosticCatalog, CilWriter, readPE } from '@sharpforge/cil';
import { exceptionFixture } from './support/exception-encoding.js';

const bytes = new Uint8Array(40);
const caught = (start = 0, end = 4, target = 4, handlerEnd = 8) => ({ start, end, target, handlerEnd, catchType: 0x01000001 });
const filtered = (start, end, filterOffset, target, handlerEnd) => ({ flags: 1, start, end, filterOffset, target, handlerEnd });
const errorCode = code => error => error.name === 'CilError' && error.code === code;
const build = (handlers, options) => buildExceptionRegionTree(bytes, handlers, options);

test('EH trees own frozen regions, preserve clause precedence and coalesce shared tries', () => {
  const handlers = [caught(0, 4, 4, 8), caught(0, 4, 8, 12), { flags: 2, start: 16, end: 20, target: 20, handlerEnd: 24 }];
  const tree = build(handlers);
  assert.equal(tree.regions.length, 5);
  assert.deepEqual(tree.roots, [0, 1, 2, 3, 4]);
  assert.deepEqual(tree.regions[0].clauses, [0, 1]);
  assert.equal(tree.clauses[0].tryRegion, tree.clauses[1].tryRegion);
  assert.equal(tree.regions[4].kind, 'finally');
  handlers[0].start = 30;
  assert.equal(tree.regions[0].start, 0);
  for (const value of [tree, tree.roots, tree.regions, tree.clauses, ...tree.regions, ...tree.clauses,
    ...tree.regions.flatMap(region => [region.children, region.clauses])]) assert(Object.isFrozen(value));
});

test('whole clauses can nest in tries and handlers with innermost clauses first', () => {
  const tree = build([caught(1, 2, 2, 3), caught(12, 13, 13, 14), caught(0, 10, 10, 20)]);
  assert.equal(tree.regions[tree.clauses[0].tryRegion].parent, tree.clauses[2].tryRegion);
  assert.equal(tree.regions[tree.clauses[1].tryRegion].parent, tree.clauses[2].handlerRegion);
  assert.equal(tree.roots.length, 2);
  const filterTree = build([filtered(0, 4, 4, 8, 12), caught(0, 4, 12, 16)]);
  assert.equal(filterTree.regions[filterTree.clauses[0].filterRegion].kind, 'filter');
});

const scalarFailures = [
  ['CILR0004', { flags: 3 }], ['CILR0005', { start: -1 }], ['CILR0006', { end: 41 }],
  ['CILR0007', { target: 1.5 }], ['CILR0008', { handlerEnd: NaN }], ['CILR0009', { end: 0 }],
  ['CILR0010', { handlerEnd: 4 }], ['CILR0011', { catchType: -1 }],
  ['CILR0012', { flags: 1, catchType: 4 }], ['CILR0013', { flags: 1, filterOffset: 2, catchType: 1 }],
  ['CILR0014', { catchType: 0x06000001 }], ['CILR0015', { flags: 2, catchType: 1 }],
];
for (const [code, change] of scalarFailures) test(`scalar clause diagnostic ${code}`, () => {
  assert.throws(() => build([{ ...caught(), ...change }]), errorCode(code));
});

const geometryFailures = [
  ['CILR0021', [caught(0, 6, 4, 8)]],
  ['CILR0022', [caught(0, 10, 20, 22), caught(5, 15, 24, 26)]],
  ['CILR0023', [caught(0, 4, 8, 12), caught(4, 8, 8, 12)]],
  ['CILR0024', [caught(), { flags: 2, start: 0, end: 4, target: 8, handlerEnd: 12 }]],
  ['CILR0025', [caught(5, 6, 6, 7), filtered(0, 4, 4, 10, 12)]],
  ['CILR0026', [caught(1, 2, 12, 13), caught(0, 10, 10, 20)]],
  ['CILR0027', [caught(0, 10, 10, 20), caught(1, 2, 2, 3)]],
];
for (const [code, handlers] of geometryFailures) test(`lexical graph diagnostic ${code}`, () => {
  assert.throws(() => build(handlers), errorCode(code));
});

test('all five EH boundaries exclude operands and prefix-group interiors', () => {
  const code = new CilWriter().op('ldc.i4', 1).op('nop').op('ldc.i4', 2).op('nop').op('ret').finish();
  const valid = caught(0, 5, 6, 11);
  const fields = [['start', 'CILR0016'], ['end', 'CILR0017'], ['target', 'CILR0018'], ['handlerEnd', 'CILR0019']];
  for (const [field, error] of fields) {
    const value = field === 'start' || field === 'end' ? 1 : 7;
    assert.throws(() => buildExceptionRegionTree(code, [{ ...valid, [field]: value }]), errorCode(error));
  }
  assert.throws(() => buildExceptionRegionTree(code, [filtered(0, 5, 7, 11, 12)]), errorCode('CILR0020'));
  const prefixed = new CilWriter().op('volatile.').op('ldind.i4').op('nop').op('ret').finish();
  assert.throws(() => buildExceptionRegionTree(prefixed, [caught(0, 2, 3, 4)]), errorCode('CILR0017'));
  assert.doesNotThrow(() => buildExceptionRegionTree(prefixed, [caught(0, 3, 3, 4)]));
});

test('input, size, depth, decoder and cancellation limits are explicit', () => {
  assert.throws(() => buildExceptionRegionTree([], []), errorCode('CILR0001'));
  for (const options of [null, { maxDepth: -1 }, { maxClauses: 100001 }, { maxInstructions: NaN }]) {
    assert.throws(() => build([], options), errorCode('CILR0001'));
  }
  assert.throws(() => build([caught()], { maxClauses: 0 }), errorCode('CILR0002'));
  assert.throws(() => build([], { maxCodeBytes: 39 }), errorCode('CILR0002'));
  assert.throws(() => build([], { signal: AbortSignal.abort() }), errorCode('CILR0003'));
  let checks = 0;
  assert.throws(() => build([caught()], { signal: { get aborted() { return ++checks > 3; } } }), errorCode('CILR0003'));
  assert.throws(() => build([caught(1, 2, 2, 3), caught(0, 10, 10, 20)], { maxDepth: 1 }), errorCode('CILR0028'));
  assert.throws(() => build([], { maxInstructions: 0 }), errorCode('CILR0029'));
  assert.throws(() => buildExceptionRegionTree(Uint8Array.of(0xff), []), errorCode('CILR0029'));
  assert.throws(() => buildExceptionRegionTree(Uint8Array.of(0xfe, 0x13), []), errorCode('CILR0030'));
  assert.equal(Object.keys(exceptionRegionDiagnosticCatalog).length, 30);
  assert.equal(buildExceptionRegionTree(new Uint8Array(), []).regions.length, 0);
});

test('native executed filter/fault method layouts pass the structural tree validator', () => {
  for (const kind of ['filter', 'fault']) {
    const fixture = exceptionFixture({ kind });
    const tree = buildExceptionRegionTree(fixture.code, fixture.handlers);
    assert.equal(tree.clauses.length, fixture.handlers.length);
  }
});

test('every IL method in the three retained Roslyn PDB fixtures passes lexical validation', () => {
  let methods = 0;
  let clauses = 0;
  for (const [folder, name] of [['portable-pdb-async-writer', 'AsyncWriter'], ['portable-pdb-hoisted-locals', 'HoistedLocals'],
    ['portable-pdb-closure-map', 'ClosureMap']]) {
    const directory = new URL(`./fixtures/${folder}/`, import.meta.url);
    const bytes = readFileSync(new URL(`${name}.dll`, directory));
    const fixture = JSON.parse(readFileSync(new URL('reference.json', directory), 'utf8'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.reference.assemblySha256);
    const pe = readPE(bytes, { inspection: true });
    for (let row = 1; row <= pe.metadata.counts[6]; row++) {
      const token = 0x06000000 | row;
      if (!pe.metadata.row(token)[0]) continue;
      const body = pe.methodBody(token);
      const tree = buildExceptionRegionTree(body.code, body.handlers);
      assert.equal(tree.clauses.length, body.handlers.length);
      methods++;
      clauses += tree.clauses.length;
    }
  }
  assert(methods >= 10);
  assert(clauses >= 2);
});

test('wide shared-try sets and deep valid trees remain bounded without recursive traversal', () => {
  const count = 10000;
  const handlers = Array.from({ length: count }, (_, index) => caught(0, 1, index + 1, index + 2));
  const tree = buildExceptionRegionTree(new Uint8Array(count + 2), handlers);
  assert.equal(tree.regions.length, count + 1);
  assert.equal(tree.regions[0].clauses.length, count);
  const depth = 250;
  const nested = Array.from({ length: depth }, (_, index) => caught(index, depth * 2 - index, depth * 2 - index, depth * 2 - index + 1));
  nested.reverse();
  assert.equal(buildExceptionRegionTree(new Uint8Array(depth * 2 + 1), nested).roots.length, 2);
});
