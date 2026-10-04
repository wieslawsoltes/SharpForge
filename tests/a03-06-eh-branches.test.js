import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CilWriter, readPE, validateExceptionBranches, exceptionBranchDiagnosticCatalog } from '@sharpforge/cil';
import { exceptionFixture } from './support/exception-encoding.js';

const check = (writer, handlers = [], options) => validateExceptionBranches(writer.finish(), handlers, options);
const errorAt = (code, offset) => error => error.code === code && error.offset === offset;
const caught = (writer, start = 'try', end = 'tryEnd', target = 'catch', handlerEnd = 'catchEnd') => ({
  start: writer.labels.get(start), end: writer.labels.get(end), target: writer.labels.get(target),
  handlerEnd: writer.labels.get(handlerEnd), catchType: 0x01000001,
});

function simple(source, operand, { inside = false, fallThrough = false } = {}) {
  const writer = new CilWriter();
  if (!inside) writer.mark('source').op(source, operand);
  writer.mark('try').op('nop').mark('middle');
  if (inside) writer.mark('source').op(source, operand);
  if (!fallThrough) writer.op('leave', 'done');
  writer.mark('tryEnd').mark('catch').op('pop').op('leave', 'done').mark('catchEnd').mark('done').op('ret');
  return { writer, handlers: [caught(writer)] };
}

test('ordinary short/long branches may enter the first try instruction and stay inside regions', () => {
  for (const name of ['br', 'br.s', 'brtrue', 'brtrue.s', 'beq', 'beq.s']) {
    const entry = simple(name, 'try');
    assert.equal(check(entry.writer, entry.handlers).clauses.length, 1);
    const loop = simple(name, 'try', { inside: true });
    assert.doesNotThrow(() => check(loop.writer, loop.handlers));
  }
});

test('ordinary branches cannot exit a region or enter a try interior or catch', () => {
  for (const name of ['br', 'br.s', 'brfalse', 'brfalse.s']) {
    const exit = simple(name, 'done', { inside: true });
    assert.throws(() => check(exit.writer, exit.handlers), errorAt('CILCF0008', exit.writer.labels.get('source')));
    for (const target of ['middle', 'catch']) {
      const entry = simple(name, target);
      assert.throws(() => check(entry.writer, entry.handlers), errorAt('CILCF0009', 0));
    }
  }
});

test('switch checks every target, and conditional/switch default edges obey fall-through restrictions', () => {
  const valid = simple('switch', ['try', 'done']);
  assert.doesNotThrow(() => check(valid.writer, valid.handlers));
  const invalid = simple('switch', ['try', 'middle']);
  assert.throws(() => check(invalid.writer, invalid.handlers), errorAt('CILCF0009', 0));
  for (const name of ['switch', 'brtrue', 'brtrue.s']) {
    const fixture = simple(name, name === 'switch' ? ['try'] : 'try', { inside: true, fallThrough: true });
    assert.throws(() => check(fixture.writer, fixture.handlers), errorAt('CILCF0010', fixture.writer.labels.get('source')));
  }
});

test('fall-through cannot exit a try/handler, enter a handler, or fall off the method', () => {
  const exited = simple('nop', undefined, { fallThrough: true });
  assert.throws(() => check(exited.writer, exited.handlers), errorAt('CILCF0010', exited.writer.labels.get('try')));
  const writer = new CilWriter().op('br', 'try').mark('try').op('throw').mark('tryEnd')
    .mark('padding').op('nop').mark('catch').op('pop').op('leave', 'done').mark('catchEnd').mark('done').op('ret');
  assert.throws(() => check(writer, [caught(writer)]), errorAt('CILCF0011', writer.labels.get('padding')));
  const handlerExit = new CilWriter().mark('try').op('throw').mark('tryEnd').mark('catch')
    .op('pop').mark('catchEnd').op('ret');
  assert.throws(() => check(handlerExit, [caught(handlerExit)]), errorAt('CILCF0010', 1));
  assert.throws(() => check(new CilWriter().op('nop')), errorAt('CILCF0013', 0));
  assert.doesNotThrow(() => check(new CilWriter().op('ret')));
  assert.doesNotThrow(() => check(new CilWriter().op('jmp', 0x06000001)));
});

test('method entry cannot begin in a handler even when its try appears later', () => {
  const writer = new CilWriter().mark('catch').op('pop').op('leave', 'done').mark('catchEnd')
    .mark('try').op('throw').mark('tryEnd').mark('done').op('ret');
  assert.throws(() => check(writer, [caught(writer)]), errorAt('CILCF0012', 0));
});

test('prefix groups reject interior branch/switch/leave targets while first-prefix targets remain legal', () => {
  for (const name of ['br', 'switch', 'leave']) {
    const writer = new CilWriter().op(name, name === 'switch' ? ['interior'] : 'interior')
      .mark('prefix').op('volatile.').mark('interior').op('ldind.i4').op('ret');
    assert.throws(() => check(writer), errorAt('CILCF0014', 0));
    const valid = new CilWriter().op(name, name === 'switch' ? ['prefix'] : 'prefix')
      .mark('prefix').op('volatile.').op('ldind.i4').op('ret');
    assert.doesNotThrow(() => check(valid));
  }
});

test('nested try entry requires every enclosing region, including coincident starts', () => {
  const writer = new CilWriter().op('br', 'innerTry').mark('outerTry').op('nop')
    .mark('innerTry').op('leave', 'outerExit').mark('innerEnd').mark('innerCatch').op('pop')
    .op('leave', 'outerExit').mark('innerCatchEnd').mark('outerExit').op('leave', 'done')
    .mark('outerEnd').mark('outerCatch').op('pop').op('leave', 'done').mark('outerCatchEnd').mark('done').op('ret');
  const handlers = [caught(writer, 'innerTry', 'innerEnd', 'innerCatch', 'innerCatchEnd'),
    caught(writer, 'outerTry', 'outerEnd', 'outerCatch', 'outerCatchEnd')];
  assert.throws(() => check(writer, handlers), errorAt('CILCF0009', 0));
  const coincident = handlers.map(handler => ({ ...handler }));
  coincident[1].start = coincident[0].start;
  assert.doesNotThrow(() => check(writer, coincident));
  const intoHandler = handlers.map(handler => ({ ...handler }));
  intoHandler[1] = { ...intoHandler[1], start: intoHandler[1].target, end: intoHandler[1].handlerEnd,
    target: handlers[1].start, handlerEnd: handlers[1].end };
  assert.throws(() => check(writer, intoHandler), errorAt('CILCF0009', 0));
});

test('branch checks work inside filter/finally/fault regions and disallow escaping them', () => {
  for (const kind of ['filter', 'fault']) {
    const fixture = exceptionFixture({ kind });
    assert.doesNotThrow(() => validateExceptionBranches(fixture.code, fixture.handlers));
  }
  for (const flags of [2, 4]) {
    const writer = new CilWriter().mark('try').op('leave', 'done').mark('tryEnd').mark('catch')
      .op('br', 'done').op('endfinally').mark('catchEnd').mark('done').op('ret');
    assert.throws(() => check(writer, [{ ...caught(writer), catchType: 0, flags }]), errorAt('CILCF0008', 5));
  }
  const writer = new CilWriter().mark('try').op('throw').mark('tryEnd').mark('filter').op('br', 'done')
    .op('endfilter').mark('catch').op('pop').op('leave', 'done').mark('catchEnd').mark('done').op('ret');
  const clause = { ...caught(writer), flags: 1, catchType: undefined, filterOffset: writer.labels.get('filter') };
  assert.throws(() => check(writer, [clause]), errorAt('CILCF0008', 1));
});

test('limits, cancellation, placement diagnostics and explicitly deferred leave targets retain their contracts', () => {
  assert.equal(Object.keys(exceptionBranchDiagnosticCatalog).length, 7);
  const writer = new CilWriter().op('ret');
  assert.throws(() => check(writer, [], { maxCodeBytes: 0 }), error => error.code === 'CILR0002');
  assert.throws(() => check(writer, [], { signal: AbortSignal.abort() }), error => error.code === 'CILR0003');
  assert.throws(() => check(new CilWriter().op('rethrow')), errorAt('CILCF0001', 0));
  const deferred = simple('leave', 'middle');
  assert.doesNotThrow(() => check(deferred.writer, deferred.handlers), 'leave EH targets remain a separate validation scope');
});

test('all IL methods in retained Roslyn native fixtures satisfy branch and fall-through rules', () => {
  let methods = 0;
  for (const [folder, name] of [['portable-pdb-async-writer', 'AsyncWriter'], ['portable-pdb-hoisted-locals', 'HoistedLocals'],
    ['portable-pdb-closure-map', 'ClosureMap']]) {
    const pe = readPE(readFileSync(new URL(`./fixtures/${folder}/${name}.dll`, import.meta.url)), { inspection: true });
    for (let row = 1; row <= pe.metadata.counts[6]; row++) {
      const token = 0x06000000 | row;
      if (!pe.metadata.row(token)[0]) continue;
      const body = pe.methodBody(token);
      assert.doesNotThrow(() => validateExceptionBranches(body.code, body.handlers), `${name}: ${token.toString(16)}`);
      methods++;
    }
  }
  assert(methods >= 10);
});

test('wide shared tries use bounded membership lookup for every switch edge', () => {
  const count = 10000;
  const writer = new CilWriter().op('switch', Array(count).fill('try')).mark('try').op('leave', 'done').mark('tryEnd');
  const handlers = [];
  for (let index = 0; index < count; index++) {
    writer.mark(`catch${index}`).op('pop').op('leave', 'done').mark(`catchEnd${index}`);
    handlers.push(caught(writer, 'try', 'tryEnd', `catch${index}`, `catchEnd${index}`));
  }
  writer.mark('done').op('ret');
  assert.equal(check(writer, handlers).regions.length, count + 1);
});
