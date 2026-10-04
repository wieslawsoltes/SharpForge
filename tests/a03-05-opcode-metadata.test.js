import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CilOpcodes, CilWriter, decodeInstructions } from '@sharpforge/cil';

const fields = ['name', 'value', 'size', 'operandType', 'stackBehaviourPop', 'stackBehaviourPush', 'flowControl', 'opCodeType'];

test('A03 opcode semantics equal every active native Reflection.Emit descriptor', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/a03-opcodes/native.json', import.meta.url), 'utf8'));
  assert.match(fixture.runtime, /^\.NET /);
  const active = fixture.opcodes.filter(opcode => opcode.opCodeType !== 'Nternal');
  assert.equal(active.length, 218);
  for (const opcode of active) {
    const actual = CilOpcodes[opcode.name];
    assert(actual, opcode.name);
    assert.deepEqual(Object.fromEntries(fields.map(field => [field, actual[field]])), opcode, opcode.name);
  }
  const reserved = fixture.opcodes.filter(opcode => opcode.opCodeType === 'Nternal');
  assert.equal(reserved.length, 8);
  assert(reserved.every(opcode => !Object.hasOwn(CilOpcodes, opcode.name)));
  assert.equal(Object.keys(CilOpcodes).length, 219, '218 native opcodes plus the existing ECMA no. prefix');
});

test('A03 token metadata distinguishes semantic tokens without changing wire encodings', () => {
  for (const [name, kind] of [['call', 'method'], ['jmp', 'method'], ['ldfld', 'field'], ['ldobj', 'type'],
    ['ldstr', 'string'], ['calli', 'sig'], ['ldtoken', 'tok']]) {
    assert.equal(CilOpcodes[name].tokenKind, kind);
    assert.equal(CilOpcodes[name].operand, 'token');
    const instruction = decodeInstructions(new CilWriter().op(name, 0x01000001).finish())[0];
    assert.equal(instruction.operandKind, 'token');
    assert.equal(instruction.operand, 0x01000001);
  }
  assert.equal(CilOpcodes.nop.tokenKind, null);
});

test('A03 variable effects, branching and prefixes remain explicit metadata rather than inferred verification', () => {
  assert.equal(CilOpcodes.call.stackBehaviourPop, 'Varpop');
  assert.equal(CilOpcodes.call.stackBehaviourPush, 'Varpush');
  assert.equal(CilOpcodes.ret.stackBehaviourPop, 'Varpop');
  assert.equal(CilOpcodes['newobj'].stackBehaviourPush, 'Pushref');
  assert.equal(CilOpcodes['brtrue.s'].flowControl, 'Cond_Branch');
  assert.equal(CilOpcodes.throw.flowControl, 'Throw');
  assert.equal(CilOpcodes['tail.'].flowControl, 'Meta');
  assert.equal(CilOpcodes['tail.'].opCodeType, 'Prefix');
  assert.deepEqual([CilOpcodes['no.'].value, CilOpcodes['no.'].operand, CilOpcodes['no.'].flowControl], [0xfe19, 'u8', 'Meta']);
  assert.throws(() => decodeInstructions(Uint8Array.of(0xf7)), /Unsupported CIL opcode/);
  assert.throws(() => new CilWriter().op('unsupported'), /Unsupported CIL opcode/);
  assert.throws(() => decodeInstructions(Uint8Array.of(0xfe)), /Truncated/);
});

function sample(operand) {
  return { '': undefined, u8: 255, i8: -128, u16: 65535, i32: -2147483648, i64: -9223372036854775808n,
    f32: 1.5, f64: -1.25, br8: 0, br32: 0, switch: [0], token: 0x02000001 }[operand];
}

test('A03 all 219 immutable opcode descriptors preserve binary writer/reader round trips', () => {
  assert(Object.isFrozen(CilOpcodes));
  const values = new Set();
  for (const opcode of Object.values(CilOpcodes)) {
    assert(Object.isFrozen(opcode));
    assert(!values.has(opcode.value), opcode.name);
    values.add(opcode.value);
    const operand = sample(opcode.operand), bytes = new CilWriter().op(opcode.name, operand).op('nop').finish();
    const instruction = decodeInstructions(bytes)[0];
    assert.equal(instruction.name, opcode.name);
    assert.equal(instruction.operandKind, opcode.operand);
    const expected = opcode.operand === 'switch' ? [instruction.size]
      : opcode.operand.startsWith('br') ? instruction.size : operand;
    assert.deepEqual(instruction.operand, expected, opcode.name);
  }
});
