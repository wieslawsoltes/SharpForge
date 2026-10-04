import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CilWriter, CilOpcodes, decodeInstructions } from '@sharpforge/cil';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { layoutFixture } from './fixtures/a03-branch-relaxation/input.js';

test('layout widens 300-byte symbolic forward and backward branches without changing default finish', () => {
  const writer = new CilWriter().op('br.s', 'forward').mark('back').zero(300)
    .op('br.s', 'back').mark('forward').op('ret');
  const originalLength = writer.length, originalLabels = new Map(writer.labels);
  assert.throws(() => writer.finish(), /Short branch displacement/);
  const result = writer.finishWithLayout(), instructions = decodeInstructions(result.code);
  assert.equal(instructions[0].name, 'br');
  assert.equal(instructions.at(-2).name, 'br');
  assert.equal(instructions[0].operand, result.offsetMap.get(writer.labels.get('forward')));
  assert.equal(instructions.at(-2).operand, result.offsetMap.get(writer.labels.get('back')));
  assert.equal(result.offsetMap.get(originalLength), result.code.length);
  assert.equal(writer.length, originalLength);
  assert.deepEqual(writer.labels, originalLabels);
  assert.deepEqual(writer.finishWithLayout().code, result.code);
});

test('all short-capable branches choose exact signed-byte boundaries', () => {
  const names = Object.values(CilOpcodes).filter(opcode => opcode.operand === 'br32').map(opcode => opcode.name);
  assert.equal(names.length, 14);
  for (const name of names) {
    for (const padding of [127, 128]) {
      const writer = new CilWriter().op(name, 'target').zero(padding).mark('target').op('ret');
      assert.equal(decodeInstructions(writer.finishWithLayout().code)[0].name, padding === 127 ? name + '.s' : name);
    }
    for (const padding of [126, 127]) {
      const writer = new CilWriter().mark('target').zero(padding).op(name, 'target');
      assert.equal(decodeInstructions(writer.finishWithLayout().code).at(-1).name, padding === 126 ? name + '.s' : name);
    }
  }
});

test('layout reaches a fixed point when one widened branch pushes another beyond its short range', () => {
  const writer = new CilWriter().op('br', 'near').op('br.s', 'far').zero(125)
    .mark('near').op('nop').zero(200).mark('far').op('ret');
  const instructions = decodeInstructions(writer.finishWithLayout().code);
  assert.equal(instructions[0].name, 'br');
  assert.equal(instructions[1].name, 'br');
});

test('numeric branches and mixed symbolic/numeric switch tables relocate through the explicit boundary map', () => {
  const writer = new CilWriter().integer(0).op('switch', ['done', 0]);
  const numericBranch = writer.length;
  writer.op('br', 0).op('br', 'done').mark('done').op('ret');
  writer.patch32(numericBranch + 1, writer.labels.get('done') - numericBranch - 5);
  const original = writer.finish(), result = writer.finishWithLayout(), instructions = decodeInstructions(result.code);
  const done = result.offsetMap.get(writer.labels.get('done'));
  assert.deepEqual(instructions[1].operand, [done, result.offsetMap.get(numericBranch)]);
  assert.equal(instructions[2].operand, done);
  assert.equal(instructions[3].operand, done);
  assert.deepEqual(writer.finish(), original);
  result.code.fill(0);
  assert.deepEqual(writer.finish(), original);
});

test('deterministic mixed branch graphs retain targets and no long branch can independently shrink', () => {
  let seed = 17;
  const random = limit => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
  for (let sample = 0; sample < 20; sample++) {
    const writer = new CilWriter(), branches = new Map();
    for (let index = 0; index < 200; index++) {
      writer.mark(`L${index}`);
      if (random(4) === 0) {
        const target = `L${random(200)}`;
        branches.set(writer.length, target);
        writer.op('br', target);
      } else writer.op('nop');
    }
    const result = writer.finishWithLayout(), byOffset = new Map(decodeInstructions(result.code).map(value => [value.offset, value]));
    for (const [oldOffset, target] of branches) {
      const instruction = byOffset.get(result.offsetMap.get(oldOffset));
      assert.equal(instruction.operand, result.offsetMap.get(writer.labels.get(target)));
      if (instruction.name === 'br') {
        const delta = instruction.operand - instruction.offset - 5;
        assert(instruction.operand > instruction.offset ? delta > 127 : delta + 3 < -128);
      }
    }
  }
});

test('layout rejects missing/interior/end targets, malformed code and invalid budgets before returning code', () => {
  assert.throws(() => new CilWriter().op('br.s', 'missing').finishWithLayout(), /Undefined IL label/);
  assert.throws(() => new CilWriter().op('br', 'end').mark('end').finishWithLayout(), /instruction boundary/);
  const interior = new CilWriter().op('br', 'middle').u8(0x20).mark('middle').u32(42).op('ret');
  assert.throws(() => interior.finishWithLayout(), /instruction boundary/);
  assert.throws(() => new CilWriter().u8(0xfe).finishWithLayout(), /Truncated/);
  assert.throws(() => new CilWriter().u8(0xff).finishWithLayout(), /Unsupported CIL opcode/);
  for (const maxInstructions of [-1, NaN, 1.5, 1_000_001]) {
    assert.throws(() => new CilWriter().finishWithLayout({ maxInstructions }), /instruction limit/);
  }
  assert.throws(() => new CilWriter().op('nop').finishWithLayout({ maxInstructions: 0 }), /instruction limit/);
  assert.equal(new CilWriter().finishWithLayout({ maxInstructions: 0 }).offsetMap.get(0), 0);
  const cancelled = new AbortController();
  cancelled.abort();
  assert.throws(() => new CilWriter().finishWithLayout({ signal: cancelled.signal }), /cancelled/);
});

test('relaxed ordinary CIL executes in the direct engine and matches pinned native CLR execution', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/a03-branch-relaxation/native.json', import.meta.url), 'utf8'));
  assert.deepEqual(fixture.results, { Main: 42, Forward127: 7, Forward128: 8, Switch: 9 });
  const vm = new CilVirtualMachine(layoutFixture());
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.returnValue, 42);
  } finally { vm.stop(); }
});
