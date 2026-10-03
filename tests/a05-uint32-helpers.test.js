import test from 'node:test';
import assert from 'node:assert/strict';
import {uint32Binary, uint32Compare, numericFormat} from '@sharpforge/bytecode';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {controlFixture} from './support/control-fixture.js';

const operands = [0, 1, 0x7fffffff, -2147483648, -1];
for (const left of operands) for (const right of operands) {
  test(`T01.3 unsigned branches compare ${left >>> 0} and ${right >>> 0}`, () => {
    assert.equal(uint32Compare(left, right), (left >>> 0) < (right >>> 0) ? -1 : (left >>> 0) > (right >>> 0) ? 1 : 0);
    const conditions = {
      'blt.un': (left >>> 0) < (right >>> 0), 'bge.un': (left >>> 0) >= (right >>> 0),
      'bgt.un': (left >>> 0) > (right >>> 0), 'ble.un': (left >>> 0) <= (right >>> 0),
      'bne.un': left !== right,
    };
    for (const [opcode, expected] of Object.entries(conditions)) {
      const bytes = controlFixture([{name: 'Program', methods: [{name: 'Main', result: 'int', body(writer) {
        writer.integer(left).integer(right).op(opcode, 'yes').integer(0).op('ret');
        writer.mark('yes').integer(1).op('ret');
      }}]}]);
      const result = new CilVirtualMachine(bytes).run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.returnValue, Number(expected), opcode);
    }
  });
}

test('T01.3 UInt32 multiplication, division and overflow preserve exact 32-bit patterns', () => {
  assert.equal(uint32Binary('mul', -1, -1), 1);
  assert.equal(uint32Binary('div.un', -1, 3), 1431655765);
  assert.equal(uint32Binary('rem.un', -1, -2147483648), 2147483647);
  assert.equal(uint32Binary('shr.un', -1, 33), 2147483647);
  assert.equal(numericFormat(uint32Binary('add', -2147483648, 2147483647), 'uint'), '4294967295');
  for (const [opcode, left, right] of [
    ['add.ovf.un', -1, 1], ['sub.ovf.un', 0, 1], ['mul.ovf.un', -2147483648, 2],
  ]) assert.throws(() => uint32Binary(opcode, left, right), {name: 'OverflowException'});
  assert.throws(() => uint32Binary('rem.un', -1, 0), {name: 'DivideByZeroException'});
});
