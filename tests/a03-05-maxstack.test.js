import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMaxStack, fixedStackEffect, CilWriter, CilOpcodes, CilError } from '@sharpforge/cil';

const returns = pops => ({ resolveStackEffect: instruction => instruction.name === 'ret' ? { pops, pushes: 0 } : null });
const analyze = (writer, options = {}) => analyzeMaxStack(writer.finish(), { ...returns(0), ...options });
const peak = (writer, expected, options) => {
  const result = analyze(writer, options);
  assert.equal(result.status, 'complete', JSON.stringify(result));
  assert.equal(result.maxStack, expected);
};

test('canonical fixed effects are immutable and variable effects have no fallback', () => {
  for (const opcode of Object.values(CilOpcodes)) {
    const effect = fixedStackEffect(opcode.name);
    const variable = opcode.stackBehaviourPop.startsWith('Var') || opcode.stackBehaviourPush.startsWith('Var');
    assert.equal(effect === null, variable, opcode.name);
    if (effect) assert.ok(Object.isFrozen(effect), opcode.name);
  }
  assert.deepEqual(fixedStackEffect('cpblk'), { pops: 3, pushes: 0 });
  assert.equal(fixedStackEffect('not-an-opcode'), null);
  const unknown = analyzeMaxStack(new CilWriter().op('ret').finish());
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.maxStack, null);
  assert.equal(unknown.diagnostics[0].code, 'CILMS0002');
});

test('exact peak includes branch joins, loops, switch and ignores unreachable variable effects', () => {
  peak(new CilWriter().integer(1).op('brtrue', 'right').integer(2).op('br', 'join')
    .mark('right').integer(3).mark('join').op('ret'), 1, returns(1));
  peak(new CilWriter().mark('loop').integer(1).op('dup').op('pop').op('brtrue', 'loop').op('ret'), 2);
  peak(new CilWriter().integer(0).op('switch', ['one', 'two']).op('br', 'done')
    .mark('one').integer(1).op('pop').op('br', 'done').mark('two').integer(2).integer(3).op('add')
    .op('pop').mark('done').op('ret'), 2);
  peak(new CilWriter().op('br', 'done').op('call', 0x06000001).mark('done').op('ret'), 0);
});

test('authoritative call, virtual, constructor, calli and ret effects use actual final opcode offsets', () => {
  const writer = new CilWriter().integer(7).op('newobj', 0x0a000001)
    .op('callvirt', 0x0a000002).op('call', 0x06000001).op('ldftn', 0x06000002).op('calli', 0x11000001).op('ret');
  const effects = new Map([
    ['newobj', { pops: 1, pushes: 1 }], ['callvirt', { pops: 1, pushes: 1 }], ['call', { pops: 1, pushes: 1 }],
    ['calli', { pops: 2, pushes: 1 }], ['ret', { pops: 1, pushes: 0 }],
  ]);
  peak(writer, 2, { resolveStackEffect: instruction => effects.get(instruction.name) });
  const prefixed = new CilWriter().op('ldnull').op('constrained.', 0x01000001).op('callvirt', 0x0a000001).op('ret');
  peak(prefixed, 1, { resolveStackEffect: instruction => {
    if (instruction.name === 'ret') return { pops: 1, pushes: 0 };
    assert.equal(instruction.opcodeOffset, 7);
    assert.equal(instruction.offset, 1);
    return { pops: 1, pushes: 1 };
  } });
});

test('underflow, inconsistent joins and nonempty terminal stacks are invalid without invented bounds', () => {
  const invalid = [
    new CilWriter().op('pop').op('ret'),
    new CilWriter().integer(1).op('ret'),
    new CilWriter().integer(1).op('jmp', 0x06000001),
    new CilWriter().integer(1).integer(1).op('localloc').op('pop').op('pop').op('ret'),
    new CilWriter().integer(0).op('brtrue', 'join').integer(1).mark('join').op('ret'),
    new CilWriter().mark('loop').integer(1).op('br', 'loop'),
    new CilWriter().op('nop'),
    new CilWriter().op('ret').op('nop'),
    new CilWriter(),
  ];
  for (const writer of invalid) {
    const result = analyze(writer);
    assert.equal(result.status, 'invalid', JSON.stringify(result));
    assert.equal(result.maxStack, null);
  }
});

test('no signature guess is made and malformed authoritative effects or prefix targets are rejected', () => {
  const code = new CilWriter().op('call', 0x06000001).op('ret').finish();
  assert.equal(analyzeMaxStack(code, returns(0)).status, 'unknown');
  for (const effect of [{ pops: -1, pushes: 0 }, { pops: 0, pushes: NaN }, { pops: 0.5, pushes: 0 }, { pops: 0, pushes: 2 }]) {
    assert.equal(analyzeMaxStack(code, { resolveStackEffect: () => effect }).status, 'invalid');
  }
  for (const unexpected of [new Error('resolver invariant'), new CilError('resolver invariant')]) {
    assert.throws(() => analyzeMaxStack(code, { resolveStackEffect: () => { throw unexpected; } }), error => error === unexpected);
  }
  const interior = new CilWriter().op('br', 'opcode').op('volatile.').mark('opcode').op('ldind.i4').op('pop').op('ret');
  assert.equal(analyze(interior).status, 'invalid');
  assert.equal(analyzeMaxStack(Uint8Array.of(0xfe, 0x13)).status, 'invalid');
});

test('UInt16 stack bound, resource budgets, cancellation and dynamic allocation facts stay explicit', () => {
  const deep = count => {
    const bytes = new Uint8Array(count + 1).fill(0x14); // ldnull, then throw clears its complete incoming stack.
    bytes[count] = 0x7a;
    return bytes;
  };
  assert.equal(analyzeMaxStack(deep(65535)).maxStack, 65535);
  const overflow = analyzeMaxStack(deep(65536));
  assert.equal(overflow.maxStack, null);
  assert.equal(overflow.diagnostics[0].code, 'CILMS0004');
  const code = new CilWriter().op('ret').finish();
  for (const budget of [{ maxDataflowSteps: 0 }, { maxDataflowInstructions: 0 }, { maxCodeBytes: 0 }, { maxInstructions: 0 }]) {
    const result = analyzeMaxStack(code, { ...returns(0), ...budget });
    assert.equal(result.status, 'limited');
    assert.equal(result.maxStack, null);
  }
  assert.equal(analyzeMaxStack(Uint8Array.of(0xfe, 0x13, 0x2a), { ...returns(0), maxPrefixes: 0 }).status, 'limited');
  for (const options of [null, [], { signal: true }, { signal: {} }, { handlers: [null] }, { maxInstructions: -1 },
    { maxDataflowSteps: -1 }, { maxDataflowInstructions: 1000001 }, { resolveStackEffect: 1 }]) {
    assert.equal(analyzeMaxStack(code, options).status, 'invalid');
  }
  assert.equal(analyzeMaxStack(code, { signal: AbortSignal.abort() }).status, 'cancelled');
  let reads = 0;
  const result = analyzeMaxStack(code, { ...returns(0), signal: { get aborted() { return ++reads >= 8; } } });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.maxStack, null);
  const allocated = analyze(new CilWriter().integer(4).op('localloc').op('pop').op('ret'));
  assert.equal(allocated.maxStack, 1);
  assert.equal(allocated.hasDynamicStackAllocation, true);
});
