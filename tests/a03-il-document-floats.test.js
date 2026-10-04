import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, CilWriter, assembleILDocument, formatILDocument, CilError } from '@sharpforge/cil';
import { managedFixture } from './managed-fixtures.js';
import { target as ilDocument } from '../scripts/conformance/fuzz/targets/il-document.js';

const methodToken = 0x06000001;
const context = { maxInputBytes: 64 * 1024, maxOutputBytes: 256 * 1024 };
const payloads = [
  ['ldc.r4', Uint8Array.of(1, 0, 0x80, 0x7f)],
  ['ldc.r4', Uint8Array.of(0x34, 0x12, 0xc0, 0xff)],
  ['ldc.r8', Uint8Array.of(1, 0, 0, 0, 0, 0, 0xf0, 0x7f)],
  ['ldc.r8', Uint8Array.of(0x45, 0x23, 0, 0, 0, 0, 0xf8, 0xff)],
];

function floatingFixture(opcode, value = NaN, payload) {
  const bytes = managedFixture({ methods: [{ name: 'Main', result: opcode === 'ldc.r4' ? 'float' : 'double',
    body: writer => writer.op(opcode, value).op('ret') }] });
  if (payload) {
    const body = new AssemblyInspector(bytes).pe.methodBody(methodToken);
    assert.equal(payload.length, opcode === 'ldc.r4' ? 4 : 8);
    bytes.set(payload, body.fileOffset + body.headerSize + 1);
  }
  return bytes;
}

function floatingInstruction(bytes, opcode) {
  const inspector = new AssemblyInspector(bytes);
  const instruction = inspector.getMethod(methodToken).instructions.find(value => value.name === opcode);
  assert.ok(instruction);
  return { instruction, code: inspector.pe.methodBody(methodToken).code };
}

function operandBytes(bytes, opcode) {
  const { instruction, code } = floatingInstruction(bytes, opcode);
  return code.slice(instruction.offset + 1, instruction.offset + instruction.size);
}

function exactRoundtrip(bytes, options = {}) {
  const document = formatILDocument(bytes);
  const rebuilt = assembleILDocument(document, options).bytes;
  assert.deepEqual(rebuilt, bytes);
  assert.equal(formatILDocument(rebuilt), document);
  assert.deepEqual(ilDocument.run(new TextEncoder().encode(document), context), {
    status: 'accepted', code: 'IL_DOCUMENT_EXACT_ROUNDTRIP',
  });
}

test('IL floating negative zero retains its sign through formatting, assembly and the exact fuzz oracle', () => {
  for (const opcode of ['ldc.r4', 'ldc.r8']) {
    const bytes = floatingFixture(opcode, -0);
    assert.ok(formatILDocument(bytes).includes(`${opcode} -0`));
    for (const relaxBranches of [false, true]) exactRoundtrip(bytes, { relaxBranches });
    const edited = assembleILDocument(formatILDocument(bytes).replace(`${opcode} -0`, `${opcode} 0`)).bytes;
    assert.notDeepEqual(edited, bytes);
    const value = floatingInstruction(edited, opcode).instruction.operand;
    assert.equal(value, 0);
    assert.equal(Object.is(value, -0), false);
    exactRoundtrip(edited);
  }
});

test('IL floating NaN instructions preserve original signaling, quiet, sign and payload bits in both layout modes', () => {
  for (const [opcode, payload] of payloads) {
    const bytes = floatingFixture(opcode, NaN, payload);
    assert.ok(Number.isNaN(floatingInstruction(bytes, opcode).instruction.operand));
    assert.deepEqual(operandBytes(bytes, opcode), payload);
    for (const relaxBranches of [false, true]) exactRoundtrip(bytes, { relaxBranches });
  }
});

test('IL NaN-to-finite edits at the original instruction label always replace the payload', () => {
  for (const [opcode, payload] of payloads) {
    const bytes = floatingFixture(opcode, NaN, payload);
    const edited = assembleILDocument(formatILDocument(bytes).replace(`${opcode} NaN`, `${opcode} 1.5`)).bytes;
    assert.equal(floatingInstruction(edited, opcode).instruction.operand, 1.5);
    assert.notDeepEqual(operandBytes(edited, opcode), payload);
    exactRoundtrip(edited);
  }
});

test('IL changing a NaN opcode width or label uses normal new-operand encoding', () => {
  const bytes = floatingFixture('ldc.r4', NaN, payloads[0][1]);
  const document = formatILDocument(bytes);
  for (const [source, opcode] of [
    [document.replace('ldc.r4 NaN', 'ldc.r8 NaN'), 'ldc.r8'],
    [document.replace('IL_0000:', 'IL_abcd:'), 'ldc.r4'],
  ]) {
    const edited = assembleILDocument(source).bytes;
    const expected = new CilWriter().op(opcode, Number('NaN')).finish().slice(1);
    assert.deepEqual(operandBytes(edited, opcode), expected);
    exactRoundtrip(edited);
  }
});

test('IL an inserted branch relocates the original NaN label without changing its payload', () => {
  for (const [opcode, payload] of payloads) {
    const document = formatILDocument(floatingFixture(opcode, NaN, payload));
    const source = document.replace(`IL_0000: ${opcode} NaN`, `IL_abcd: br IL_0000\n  IL_0000: ${opcode} NaN`);
    for (const relaxBranches of [false, true]) {
      const edited = assembleILDocument(source, { relaxBranches }).bytes;
      const { instruction } = floatingInstruction(edited, opcode);
      assert.equal(instruction.offset, relaxBranches ? 2 : 5);
      assert.deepEqual(operandBytes(edited, opcode), payload);
      exactRoundtrip(edited, { relaxBranches });
    }
  }
});

test('IL original NaN context cannot bypass malformed operand validation', () => {
  const document = formatILDocument(floatingFixture('ldc.r8', NaN, payloads[2][1]));
  for (const operand of ['NaN junk', '+NaN', 'nan', '']) {
    assert.throws(() => assembleILDocument(document.replace('ldc.r8 NaN', `ldc.r8 ${operand}`)), CilError);
  }
  assert.throws(() => assembleILDocument(document.replace('ldc.r8 NaN', 'ldc.i4 NaN')), CilError);
});
