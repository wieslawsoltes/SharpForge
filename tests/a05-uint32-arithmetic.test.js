import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {uint32Binary, uint32Compare} from '@sharpforge/bytecode';
import {AssemblyInspector} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/a05/uint32-arithmetic/native-boundaries.json', import.meta.url), 'utf8'));
const relations = new Map([
  ['clt.un', order => order < 0], ['cgt.un', order => order > 0],
  ['blt.un', order => order < 0], ['ble.un', order => order <= 0],
  ['bgt.un', order => order > 0], ['bge.un', order => order >= 0],
  ['bne.un', order => order !== 0],
]);

test('UInt32 helpers preserve signed i4 patterns and exact low multiplication bits', () => {
  for (const [opcode, left, right, expected] of [
    ['add', -1, 1, 0], ['sub', 0, 1, -1], ['mul', -1, -1, 1],
    ['mul', 2147483647, 2147483647, 1], ['div.un', -1, 2, 2147483647],
    ['rem.un', -1, -2147483648, 2147483647], ['shr.un', -1, 0, -1],
    ['add.ovf.un', 2147483647, 1, -2147483648],
    ['sub.ovf.un', -1, 1, -2], ['mul.ovf.un', 2147483647, 2, -2],
  ]) {
    assert.equal(uint32Binary(opcode, left, right), expected, opcode);
  }
  for (const count of [0, 32, 64, -32]) assert.equal(uint32Binary('shr.un', -1, count), -1);
  for (const count of [1, 33, 65]) assert.equal(uint32Binary('shr.un', -1, count), 2147483647);
  for (const count of [-1, 31, 63]) assert.equal(uint32Binary('shr.un', -1, count), 1);
});

test('UInt32 comparison accepts either host unsigned values or signed stack patterns', () => {
  assert.equal(uint32Compare(-1, 4294967295), 0);
  assert.equal(uint32Compare(-2147483648, 2147483648), 0);
  assert.equal(uint32Compare(-2147483648, 2147483647), 1);
  assert.equal(uint32Compare(-1, -2147483648), 1);
  assert.equal(uint32Compare(0, -1), -1);
});

test('UInt32 managed faults distinguish overflow, division by zero and unknown operations', () => {
  for (const [opcode, left, right] of [
    ['add.ovf.un', -1, 1], ['sub.ovf.un', 0, 1], ['mul.ovf.un', -1, 2],
  ]) assert.throws(() => uint32Binary(opcode, left, right), {name: 'OverflowException'});
  for (const opcode of ['div.un', 'rem.un']) {
    assert.throws(() => uint32Binary(opcode, -1, 0), {
      name: 'DivideByZeroException', message: 'Attempted to divide by zero',
    });
  }
  assert.throws(() => uint32Binary('invalid', 1, 1), {name: 'CilError'});
  const managed = new Error('managed');
  const fault = (name, message) => {
    assert.equal(name, 'OverflowException');
    assert.equal(message, 'Checked arithmetic overflow');
    return managed;
  };
  assert.throws(() => uint32Binary('add.ovf.un', -1, 1, {fault}), error => error === managed);
  assert.throws(() => uint32Binary('invalid', 1, 1, {error: () => managed}), error => error === managed);
});

test('UInt32 public helpers match the full native boundary matrix', () => {
  for (const row of native.rows) {
    for (const [index, opcode] of native.operations.entries()) {
      const expected = row.results[index];
      const evaluate = () => relations.has(opcode)
        ? Number(relations.get(opcode)(uint32Compare(row.left, row.right)))
        : uint32Binary(opcode, row.left, row.right);
      const label = `${opcode} ${row.left}, ${row.right}`;
      if (expected.startsWith('!')) assert.throws(evaluate, {name: expected.slice(1)}, label);
      else assert.equal(evaluate(), Number(expected), label);
    }
  }
});

function operationAssembly(opcode) {
  const base = opcode.endsWith('.s') ? opcode.slice(0, -2) : opcode;
  const comparison = relations.has(base);
  const branch = base.startsWith('b');
  return managedFixture({entry: null, methods: [{
    name: 'Evaluate', parameters: ['uint', 'uint'], result: comparison ? 'int' : 'uint', maxStack: 2,
    body(writer) {
      writer.op('ldarg.0').op('ldarg.1');
      if (branch) {
        writer.op(opcode, 'taken').op('ldc.i4.0').op('ret');
        writer.mark('taken').op('ldc.i4.1').op('ret');
      } else writer.op(opcode).op('ret');
    },
  }]});
}

for (const [index, opcode] of native.operations.entries()) {
  const variants = opcode.startsWith('b') ? [opcode, opcode + '.s'] : [opcode];
  for (const instruction of variants) {
    test(`Direct CIL UInt32 native matrix: ${instruction}`, () => {
      const inspector = new AssemblyInspector(operationAssembly(instruction));
      for (const row of native.rows) {
        const expected = row.results[index];
        const vm = new CilVirtualMachine(inspector, {
          methodToken: 'Evaluate', arguments: [row.left >>> 0, row.right >>> 0],
        });
        const result = vm.run();
        const label = `${instruction} ${row.left}, ${row.right}`;
        if (expected.startsWith('!')) {
          assert.equal(result.state, 'faulted', label);
          assert.equal(result.fault.name, expected.slice(1), label);
        } else {
          assert.equal(result.state, 'terminated', result.fault?.stack);
          const value = relations.has(opcode) ? Number(expected) : Number(expected) >>> 0;
          assert.equal(result.returnValue, value, label);
        }
      }
    });
  }
}

test('UInt32 host arguments, returned values and declared Console formatting preserve the high bit', () => {
  const bytes = managedFixture({methods: [{
    name: 'Identity', parameters: ['uint'], result: 'uint', maxStack: 1,
    body(writer, context) {
      writer.op('ldarg.0').op('call', context.member('System.Console', 'WriteLine', 'void', ['uint']));
      writer.op('ldarg.0').op('ret');
    },
  }]});
  for (const input of [0, 1, 2147483647, 2147483648, 4294967295]) {
    const result = new CilVirtualMachine(bytes, {arguments: [input]}).run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.returnValue, input);
    assert.equal(result.output, `${input}\n`);
  }
  for (const input of [-1, 4294967296, 1.5, NaN, Infinity, '4294967295']) {
    assert.throws(() => new CilVirtualMachine(bytes, {arguments: [input]}), /integer|out of range/);
  }
});
