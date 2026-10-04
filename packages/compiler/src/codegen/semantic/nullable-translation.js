import {managedAddress} from '../memory-nodes.js';
import {readonlyReceiver} from './struct-translation.js';
import {sourceNullableElement, numericTypeId} from '@sharpforge/bytecode';
import {isNullableType, stripNullable} from '../../conversions/nullable.js';
import {n} from './node-factory.js';

function operation(owner, mode, operand = null, fallback = null) {
  const result = mode <= 1 ? owner : mode === 2 ? 'bool' : mode === 6 ? 'string' : sourceNullableElement(owner);
  return {kind: 'NullableOperation', owner, mode, operand, fallback, legacyType: result, isExpression: true};
}

function mutableTextReceiver(value) {
  if (value.kind === 'Sequence') {
    const operand = mutableTextReceiver(value.value);
    return {...value, value: operand, legacyType: operand.legacyType};
  }
  return ['Local', 'Parameter', 'FieldAccess', 'ArrayAccess', 'ManagedDereference',
    'RectangularElement', 'SpanElement'].includes(value.kind) ? managedAddress(value) : value;
}

/** Nullable values use a copied optional payload, with CLR boxing and explicit Value faults. */
export const NullableTranslation = Base => class extends Base {
  constant(node) {
    if (isNullableType(node.type) && node.constantValue?.isNull) return operation(this.imageType(node.type, node.syntax), 0);
    return super.constant(node);
  }

  defaultValue(type) {
    return sourceNullableElement(type) ? operation(type, 0) : super.defaultValue(type);
  }

  exprConversion(node) {
    const steps = node.conversion?.steps;
    if (!steps || !isNullableType(node.type) && !isNullableType(node.operand.type)) return super.exprConversion(node);
    const target = this.imageType(node.type, node.syntax), from = this.imageType(node.operand.type, node.syntax);
    const value = this.expression(node.operand);
    const convert = input => {
      const type = this.imageType(stripNullable(node.type), node.syntax);
      if (input.legacyType === type) return input;
      if (numericTypeId(input.legacyType) !== undefined && numericTypeId(type) !== undefined) {
        return n.convert(input, type, !!node.isChecked);
      }
      const method = node.conversion.underlying?.method;
      if (method && this.g.isSource(method)) return n.call(this.g.methodOf(method, node.syntax), null, [input]);
      return this.unsupported('this nullable underlying conversion', node.syntax);
    };
    if (steps[0] === 'wrap') return operation(target, 1, convert(value));
    if (steps[0] === 'unwrap') return convert(operation(from, 3, value));
    const temporary = this.temp(from, 'nullableConversion');
    const read = n.local(temporary);
    return n.sequence([temporary], [n.assign(read, value)],
      n.conditional(operation(from, 2, read), operation(target, 1, convert(operation(from, 4, read))), operation(target, 0)));
  }

  exprObjectCreation(node) {
    if (!isNullableType(node.type)) return super.exprObjectCreation(node);
    const owner = this.imageType(node.type, node.syntax);
    const args = this.arguments(node, node.constructor ?? node.constructorMethod);
    return args.length ? operation(owner, 1, args[0]) : operation(owner, 0);
  }

  exprPropertyAccess(node) {
    if (!isNullableType(node.receiver?.type)) return super.exprPropertyAccess(node);
    const mode = {HasValue: 2, Value: 3}[node.property.name];
    return mode === undefined ? super.exprPropertyAccess(node) :
      operation(this.imageType(node.receiver.type, node.syntax), mode, this.expression(node.receiver));
  }

  exprCall(node) {
    if (!isNullableType(node.receiver?.type)) return super.exprCall(node);
    const owner = this.imageType(node.receiver.type, node.syntax), receiver = this.expression(node.receiver);
    if (node.method.name === 'ToString' && !node.args.length) {
      const operand = readonlyReceiver(node.receiver) ? receiver : mutableTextReceiver(receiver);
      return operation(owner, 6, operand);
    }
    if (node.method.name !== 'GetValueOrDefault') return super.exprCall(node);
    const args = this.arguments(node, node.method);
    return operation(owner, args.length ? 5 : 4, receiver, args[0] ?? null);
  }
};
