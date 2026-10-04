import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CilWriter, readPE, buildExceptionRegionTree, validateExceptionControlFlow,
  validateExceptionBranches, exceptionLeaveDiagnosticCatalog } from '@sharpforge/cil';
import { ExceptionLeaveIndex } from '../packages/cil/src/eh-regions/leave-index.js';
import { ecmaLeaveAllowed } from './support/eh-leave-rules.js';
import { exceptionFixture } from './support/exception-encoding.js';

const caught = (start, end, target, handlerEnd) => ({ start, end, target, handlerEnd, catchType: 0x01000001 });
const filtered = (start, end, filterOffset, target, handlerEnd) => ({ flags: 1, start, end, filterOffset, target, handlerEnd });
const finalizer = (flags, start, end, target, handlerEnd) => ({ flags, start, end, target, handlerEnd });
const errorAt = (code, offset) => error => error.code === code && error.offset === offset;
const clause = writer => caught(...['try', 'tryEnd', 'catch', 'catchEnd'].map(label => writer.labels.get(label)));
const check = (writer, handlers = [], options) => validateExceptionControlFlow(writer.finish(), handlers, options);

test('leave and leave.s exit tries/catches, enter a first try or return to the associated try interior', () => {
  for (const leave of ['leave', 'leave.s']) {
    const writer = new CilWriter().op(leave, 'try').mark('try').op('nop').mark('interior')
      .op(leave, 'done').mark('tryEnd').mark('catch').op('pop').op(leave, 'interior')
      .mark('catchEnd').mark('done').op('ret');
    const tree = check(writer, [clause(writer)]);
    assert.equal(tree.regions.length, 2);
    assert(Object.isFrozen(tree));
  }
});

test('leave keeps exact source offsets and rejects filter/finally/fault exits', () => {
  for (const flags of [2, 4]) {
    const writer = new CilWriter().mark('try').op('leave', 'done').mark('tryEnd').mark('catch')
      .mark('source').op('leave', 'done').op('endfinally').mark('catchEnd').mark('done').op('ret');
    assert.throws(() => check(writer, [{ ...clause(writer), catchType: 0, flags }]),
      errorAt('CILCF0015', writer.labels.get('source')));
    const same = new CilWriter().mark('try').op('leave', 'done').mark('tryEnd').mark('catch')
      .op('leave', 'end').mark('end').op('endfinally').mark('catchEnd').mark('done').op('ret');
    assert.doesNotThrow(() => check(same, [{ ...clause(same), catchType: 0, flags }]));
  }
  const writer = new CilWriter().op('throw').mark('filter').op('leave', 'done').op('endfilter')
    .mark('catch').op('pop').op('leave', 'done').mark('done').op('ret');
  assert.throws(() => check(writer, [filtered(0, 1, 1, writer.labels.get('catch'), writer.labels.get('done'))]),
    errorAt('CILCF0015', 1));
});

test('outside leave cannot enter handlers or non-first try instructions; branch-only API remains separate', () => {
  for (const [target, code] of [['catch', 'CILCF0018'], ['interior', 'CILCF0019']]) {
    const writer = new CilWriter().op('leave', target).mark('try').op('nop').mark('interior')
      .op('leave', 'done').mark('tryEnd').mark('catch').op('pop').op('leave', 'done')
      .mark('catchEnd').mark('done').op('ret');
    assert.doesNotThrow(() => validateExceptionBranches(writer.finish(), [clause(writer)]));
    assert.throws(() => check(writer, [clause(writer)]), errorAt(code, 0));
  }
});

const graphs = [
  [caught(10, 20, 30, 40), caught(10, 20, 45, 55), filtered(60, 70, 75, 80, 90),
    finalizer(2, 100, 110, 115, 125), finalizer(4, 130, 140, 145, 155)],
  [caught(10, 20, 20, 30), filtered(40, 50, 50, 55, 60), finalizer(2, 105, 115, 115, 120),
    caught(125, 130, 130, 135), caught(0, 100, 100, 150)],
  [caught(0, 5, 5, 10), caught(0, 20, 20, 30)],
  [caught(22, 24, 24, 26), caught(15, 20, 20, 30), caught(0, 10, 10, 50)],
  [caught(22, 24, 24, 26), caught(15, 20, 20, 30), caught(0, 10, 10, 50), caught(0, 80, 80, 90)],
  [caught(3, 5, 5, 7), caught(22, 24, 24, 26), caught(15, 20, 20, 30), caught(0, 10, 10, 50)],
  [caught(15, 20, 20, 25), caught(0, 10, 10, 50)],
];

test('indexed leave rules equal literal ECMA rules for every source/target pair in seven nested region graphs', () => {
  let cases = 0;
  for (const handlers of graphs) {
    const tree = buildExceptionRegionTree(new Uint8Array(160), handlers);
    const index = new ExceptionLeaveIndex(tree);
    for (let source = 0; source < 160; source++) {
      for (let target = 0; target < 160; target++) {
        assert.equal(index.failure(source, target) === null, ecmaLeaveAllowed(tree, source, target),
          `graph ${graphs.indexOf(handlers)}: ${source} -> ${target}`);
        cases++;
      }
    }
  }
  assert.equal(cases, 179200);
});

test('source restrictions distinguish nested catch/try exits and common enclosing tries', () => {
  const index = handlers => new ExceptionLeaveIndex(buildExceptionRegionTree(new Uint8Array(160), handlers));
  assert.equal(index(graphs[3]).failure(25, 8), 'CILCF0017', 'ECMA Example 3: inner catch cannot return to outer associated try');
  assert.equal(index(graphs[6]).failure(16, 8), 'CILCF0016', 'nested try in a catch has its own source restriction');
  assert.equal(index(graphs[4]).failure(25, 8), null, 'a common outer try permits the source transfer');
  assert.equal(index(graphs[5]).failure(16, 3), null, 'first nested try target still enforces outer associated-catch entry');
});

test('full EH API reuses all existing boundaries, placement, branch and cancellation diagnostics', () => {
  assert.equal(Object.keys(exceptionLeaveDiagnosticCatalog).length, 5);
  assert.throws(() => check(new CilWriter().op('rethrow')), errorAt('CILCF0001', 0));
  assert.throws(() => check(new CilWriter().op('nop')), errorAt('CILCF0013', 0));
  const prefix = new CilWriter().op('leave', 'inside').op('volatile.').mark('inside').op('ldind.i4').op('ret');
  assert.throws(() => check(prefix), errorAt('CILCF0014', 0));
  assert.throws(() => check(new CilWriter().op('ret'), [], { signal: AbortSignal.abort() }), error => error.code === 'CILR0003');
  assert.throws(() => check(new CilWriter().op('ret'), [], { maxInstructions: 0 }), error => error.code === 'CILR0029');
  const tree = buildExceptionRegionTree(new Uint8Array(160), graphs[0]);
  let checks = 0;
  assert.throws(() => new ExceptionLeaveIndex(tree, { get aborted() { return ++checks > 35; } }), error => error.code === 'CILR0003');
});

test('wide shared-try catch families and deep nesting remain indexed without recursive walks', () => {
  const count = 10000;
  const handlers = Array.from({ length: count }, (_, index) => caught(0, 2, index * 2 + 2, index * 2 + 4));
  const tree = buildExceptionRegionTree(new Uint8Array(count * 2 + 5), handlers);
  const index = new ExceptionLeaveIndex(tree);
  for (let handler = 0; handler < count; handler++) assert.equal(index.failure(handler * 2 + 2, 1), null);
  const depth = 500;
  const nested = Array.from({ length: depth }, (_, level) => caught(level, depth * 2 - level,
    depth * 2 - level, depth * 2 - level + 1)).reverse();
  const deep = new ExceptionLeaveIndex(buildExceptionRegionTree(new Uint8Array(depth * 2 + 2), nested));
  assert.equal(deep.failure(depth, depth * 2 + 1), null);
});

test('native filter/fault fixtures and all retained Roslyn methods pass complete lexical EH flow validation', () => {
  for (const kind of ['filter', 'fault']) {
    const fixture = exceptionFixture({ kind });
    assert.doesNotThrow(() => validateExceptionControlFlow(fixture.code, fixture.handlers));
  }
  let methods = 0;
  for (const [folder, name] of [['portable-pdb-async-writer', 'AsyncWriter'], ['portable-pdb-hoisted-locals', 'HoistedLocals'],
    ['portable-pdb-closure-map', 'ClosureMap']]) {
    const pe = readPE(readFileSync(new URL(`./fixtures/${folder}/${name}.dll`, import.meta.url)), { inspection: true });
    for (let row = 1; row <= pe.metadata.counts[6]; row++) {
      const token = 0x06000000 | row;
      if (!pe.metadata.row(token)[0]) continue;
      const body = pe.methodBody(token);
      assert.doesNotThrow(() => validateExceptionControlFlow(body.code, body.handlers), `${name}: ${token.toString(16)}`);
      methods++;
    }
  }
  assert(methods >= 10);
});
