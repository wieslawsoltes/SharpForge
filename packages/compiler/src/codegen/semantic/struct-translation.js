import {
  numericTypeId, sourceNullableElement
} from '@sharpforge/bytecode';
import {
  n
} from './node-factory.js';
import {
  isSourceValueType
} from './source-type-shape.js';
import {sourceValueObjectOverride} from './object-slots.js';

export function readonlyReceiver(node) {
  if (!node) return false;
  if (node.kind === 'Parameter') return ['in', 'ref readonly'].includes(node.parameter.refKind);
  if (node.kind === 'Local') return ['in', 'ref readonly'].includes(node.local.refKind);
  if (node.kind === 'FieldAccess') return !!node.field.isReadOnly || readonlyReceiver(node.receiver);
  if (node.kind === 'Call') return node.method?.refKind === 'ref readonly';
  if (node.kind === 'PropertyAccess') return node.property?.refKind === 'ref readonly';
  return false;
}

/** Struct expressions preserve value storage; mutating readonly receivers operates on a temporary. */
export const StructTranslation = Base => class extends Base {
  exprCall(node) {
    const receiverType = node.receiver?.type && this.g.generics.close(node.receiver.type);
    const target = node.method && sourceValueObjectOverride(node.method, receiverType);
    return target && this.g.isSource(target) ? super.exprCall({...node, method: target}) : super.exprCall(node);
  }

  defaultValue(type) {
    return isSourceValueType(this.g.program, type) ? n.allocate(this.g.program.typesByName.get(type)) : super.defaultValue(type);
  }

  receiver(node) {
    const value = super.receiver(node);
    return this.structReceiver(value, node.receiver);
  }

  memberReceiver(node) {
    const value = super.memberReceiver(node);
    return node.kind === 'PropertyAccess' || node.kind === 'IndexerAccess' ? this.structReceiver(value, node.receiver) : value;
  }

  structReceiver(value, bound) {
    if (!value || !isSourceValueType(this.g.program, value.legacyType) || !readonlyReceiver(bound)) return value;
    const temporary = this.temp(value.legacyType, 'readonlyReceiver');
    return n.sequence([temporary], [n.assign(n.local(temporary), value)], n.local(temporary));
  }

  box(operand, node) {
    const type = this.imageType(operand.type, node.syntax);
    const sourceStruct = isSourceValueType(this.g.program, type);
    if (!sourceStruct && !sourceNullableElement(type) && numericTypeId(type) === undefined && type !== 'bool') return super.box(operand, node);
    const value = this.expression(operand);
    return {
      kind: 'BoxValue',
      legacyType: 'object',
      isExpression: true,
      operand: value,
      valueType: value.legacyType
    };
  }

  exprConversion(node) {
    const target = node.conversion?.kind === 'Unboxing' ? this.imageType(node.type, node.syntax) : null;
    if (target === null || !sourceNullableElement(target) && !isSourceValueType(this.g.program, target) &&
        numericTypeId(target) === undefined && target !== 'bool') {
      return super.exprConversion(node);
    }
    return {
      kind: 'UnboxValue',
      legacyType: this.imageType(node.type, node.syntax),
      isExpression: true,
      operand: this.expression(node.operand)
    };
  }
};
