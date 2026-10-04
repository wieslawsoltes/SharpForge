import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMaxStack, CilWriter } from '@sharpforge/cil';

const returnEffect = instruction => instruction.name === 'ret' ? { pops: 0, pushes: 0 } : null;
const at = (writer, name) => writer.labels.get(name);
const analyze = (writer, handlers) => analyzeMaxStack(writer.finish(), { handlers, resolveStackEffect: returnEffect });

function fixture(kind, handlerBody = writer => writer.integer(1).integer(2).op('pop').op('pop')) {
  const writer = new CilWriter().mark('try').op('nop').op('leave', 'done').mark('tryEnd');
  if (kind === 1) writer.mark('filter').op('pop').integer(1).integer(2).integer(3).op('pop').op('pop').op('endfilter');
  writer.mark('handler');
  if (kind === 0 || kind === 1) writer.op('pop');
  handlerBody(writer);
  if (kind === 0 || kind === 1) writer.op('leave', 'done');
  else writer.op('endfinally');
  writer.mark('done').op('ret');
  const clause = { flags: kind, start: at(writer, 'try'), end: at(writer, 'tryEnd'),
    target: at(writer, 'handler'), handlerEnd: at(writer, 'done'),
    ...(kind === 0 ? { catchType: 0x01000001 } : {}),
    ...(kind === 1 ? { filterOffset: at(writer, 'filter') } : {}),
  };
  return { writer, handlers: [clause] };
}

test('catch, filter, filtered handler, finally and fault roots contribute independent peaks', () => {
  for (const kind of [0, 1, 2, 4]) {
    const input = fixture(kind);
    const result = analyze(input.writer, input.handlers);
    assert.equal(result.status, 'complete', JSON.stringify(result));
    assert.equal(result.maxStack, kind === 1 ? 3 : 2);
  }
  const filteredHandler = fixture(1, writer => {
    for (let index = 0; index < 5; index++) writer.integer(index);
    for (let index = 0; index < 5; index++) writer.op('pop');
  });
  assert.equal(analyze(filteredHandler.writer, filteredHandler.handlers).maxStack, 5);
  const catchSeed = fixture(0, () => {});
  assert.equal(analyze(catchSeed.writer, catchSeed.handlers).maxStack, 1);
});

test('nested try coincident with catch or filtered handler receives the injected exception', () => {
  for (const kind of [0, 1]) {
    const writer = new CilWriter().op('ldnull').op('throw').mark('tryEnd');
    if (kind === 1) writer.mark('filter').op('pop').integer(1).op('endfilter');
    writer.mark('handler').op('pop').op('leave', 'innerDone').mark('finally').op('endfinally')
      .mark('innerDone').op('leave', 'done').mark('done').op('ret');
    const handlers = [
      { flags: 2, start: at(writer, 'handler'), end: at(writer, 'finally'),
        target: at(writer, 'finally'), handlerEnd: at(writer, 'innerDone') },
      { flags: kind, start: 0, end: at(writer, 'tryEnd'), target: at(writer, 'handler'), handlerEnd: at(writer, 'done'),
        ...(kind === 1 ? { filterOffset: at(writer, 'filter') } : { catchType: 0x01000001 }) },
    ];
    const result = analyze(writer, handlers);
    assert.equal(result.status, 'complete', JSON.stringify(result));
    assert.equal(result.maxStack, 1);
  }
});

test('leave clears its outgoing stack but retains the incoming peak', () => {
  const writer = new CilWriter().integer(1).integer(2).op('leave', 'done').mark('finally').op('endfinally')
    .mark('done').op('ret');
  const handlers = [{ flags: 2, start: 0, end: at(writer, 'finally'),
    target: at(writer, 'finally'), handlerEnd: at(writer, 'done') }];
  const result = analyze(writer, handlers);
  assert.equal(result.status, 'complete', JSON.stringify(result));
  assert.equal(result.maxStack, 2);
});

test('ordinary nonempty try entry, invalid terminal residue and malformed clauses are rejected', () => {
  const writer = new CilWriter().integer(1).mark('try').op('pop').op('leave', 'done')
    .mark('finally').op('endfinally').mark('done').op('ret');
  const handlers = [{ flags: 2, start: at(writer, 'try'), end: at(writer, 'finally'),
    target: at(writer, 'finally'), handlerEnd: at(writer, 'done') }];
  assert.equal(analyze(writer, handlers).diagnostics[0].code, 'CILMS0003');
  const residue = fixture(2, body => body.integer(1));
  assert.equal(analyze(residue.writer, residue.handlers).diagnostics[0].code, 'CILMS0003');
  const filtered = fixture(1);
  for (const update of [{ filterOffset: -1 }, { catchType: 999 }, { start: 2 }, { flags: 3 }]) {
    const result = analyze(filtered.writer, [{ ...filtered.handlers[0], ...update }]);
    assert.equal(result.status, 'invalid', JSON.stringify(result));
    assert.equal(result.maxStack, null);
  }
});

test('grouped tail prefixes retain EH placement validation and structural transfers stay checked', () => {
  const writer = new CilWriter().op('tail.').op('call', 0x06000001).op('leave', 'done')
    .mark('finally').op('endfinally').mark('done').op('ret');
  const handlers = [{ flags: 2, start: 0, end: at(writer, 'finally'),
    target: at(writer, 'finally'), handlerEnd: at(writer, 'done') }];
  assert.equal(analyze(writer, handlers).diagnostics[0].code, 'CILCF0006');
  const bad = fixture(0);
  const bytes = bad.writer.finish();
  bytes[1] = 0x38; // br has the same operand size as leave, but cannot exit the protected try.
  const result = analyzeMaxStack(bytes, { handlers: bad.handlers, resolveStackEffect: returnEffect });
  assert.equal(result.diagnostics[0].code, 'CILCF0008');
  for (const opcode of ['endfinally', 'rethrow', 'endfilter']) {
    assert.equal(analyze(new CilWriter().op(opcode), []).status, 'invalid');
  }
});
