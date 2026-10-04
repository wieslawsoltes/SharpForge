import {Op, Binary, Unary, NumericType, numericMode, EnumConvertBase} from '@sharpforge/bytecode';
import {enumTypes} from '@sharpforge/framework';
import {isScalarType, extendedScalar, binaryScalarType, unaryScalarType} from './scalar-values.js';

function convert(emitter, from, to, checked = false) {
  if (from !== to) emitter.emit(Op.CONVERT, NumericType[to], numericMode(from, checked));
}

function binary(emitter, operator, left, right, options = {}) {
  const {checked = false, promoted = binaryScalarType(left, right, operator)} = options;
  const rightType = ['<<', '>>', '>>>'].includes(operator) ? 'int' : promoted;
  if (left !== promoted) {
    const saved = emitter.temp(right);
    emitter.emit(Op.STLOC, saved);
    emitter.emit(Op.POP);
    convert(emitter, left, promoted);
    emitter.emit(Op.LDLOC, saved);
  }
  convert(emitter, right, rightType);
  emitter.emit(Op.BINARY, Binary[operator], numericMode(promoted, checked));
  return promoted;
}

/** A narrow IR contribution for scalar modes; legacy Int32/Double instruction IDs stay unchanged. */
export function emitScalarExpression(emitter, node) {
  if (node.kind === 'Conversion' && (extendedScalar(node.legacyType) || extendedScalar(node.operand.legacyType))) {
    emitter.expr(node.operand);
    const target = enumTypes.indexOf(node.legacyType);
    const source = isScalarType(node.operand.legacyType) ? node.operand.legacyType : 'int';
    emitter.emit(Op.CONVERT, target >= 0 ? EnumConvertBase + target : NumericType[node.legacyType], numericMode(source, !!node.isChecked));
    return true;
  }
  if (node.kind === 'UnaryOperator' && (extendedScalar(node.operand.legacyType) || extendedScalar(node.legacyType))) {
    emitter.expr(node.operand);
    convert(emitter, node.operand.legacyType, node.legacyType);
    emitter.emit(Op.UNARY, Unary[node.operator], numericMode(node.legacyType, !!node.isChecked));
    return true;
  }
  if (node.kind === 'BinaryOperator' && isScalarType(node.left.legacyType) && isScalarType(node.right.legacyType) &&
      (extendedScalar(node.left.legacyType) || extendedScalar(node.right.legacyType) || node.operator === '>>>')) {
    emitter.expr(node.left);
    emitter.expr(node.right);
    binary(emitter, node.operator, node.left.legacyType, node.right.legacyType, {checked: !!node.isChecked});
    return true;
  }
  if (node.kind === 'IncrementOperator' && extendedScalar(node.legacyType)) {
    const reference = emitter.prepare(node.operand);
    emitter.loadRef(reference);
    const previous = node.isPostfix ? emitter.temp(reference.type) : null;
    if (previous !== null) emitter.emit(Op.STLOC, previous);
    emitter.emitConstant(1);
    const promoted = unaryScalarType(reference.type);
    binary(emitter, node.operator === '++' ? '+' : '-', reference.type, 'int', {checked: !!node.isChecked, promoted});
    convert(emitter, promoted, reference.type, !!node.isChecked);
    emitter.storeRef(reference);
    if (previous !== null) {
      emitter.emit(Op.POP);
      emitter.emit(Op.LDLOC, previous);
    }
    return true;
  }
  if (node.kind === 'CompoundAssignmentOperator' &&
      (extendedScalar(node.legacyType) || extendedScalar(node.right.legacyType) || node.operator === '>>>')) {
    const reference = emitter.prepare(node.left);
    emitter.loadRef(reference);
    emitter.expr(node.right);
    const promoted = binary(emitter, node.operator, reference.type, node.right.legacyType, {checked: !!node.isChecked});
    convert(emitter, promoted, reference.type, !!node.isChecked);
    emitter.storeRef(reference);
    return true;
  }
  return false;
}
