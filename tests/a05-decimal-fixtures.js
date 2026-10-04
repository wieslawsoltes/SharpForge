import {fieldSignature} from '@sharpforge/cil';
import {managedFixture} from './managed-fixtures.js';

export const decimalSignature = 'valuetype System.Decimal';
export function emitDecimal(writer, context, coefficient, scale = 0, negative = false) {
  const value = BigInt(coefficient);
  writer.op('ldc.i4', Number(BigInt.asIntN(32, value))).op('ldc.i4', Number(BigInt.asIntN(32, value >> 32n)));
  writer.op('ldc.i4', Number(BigInt.asIntN(32, value >> 64n))).op('ldc.i4', Number(negative)).op('ldc.i4', scale);
  writer.op('newobj', context.member('System.Decimal', '.ctor', 'void', ['int', 'int', 'int', 'bool', 'byte'], false));
}
export function decimalField(context, name) {
  return context.md.member(context.resolve('System.Decimal'), name,
    fieldSignature(decimalSignature, context.resolve));
}
export function decimalArithmeticFixture(name, left, right) {
  return managedFixture({methods: [{name: 'Main', result: decimalSignature, body(writer, context) {
    emitDecimal(writer, context, ...left);
    emitDecimal(writer, context, ...right);
    writer.op('call', context.member('System.Decimal', name, decimalSignature, [decimalSignature, decimalSignature])).op('ret');
  }}]});
}
