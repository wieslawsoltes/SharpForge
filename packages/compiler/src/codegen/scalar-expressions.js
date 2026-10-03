import {Op, Binary, Unary, NumericType, numericMode, EnumConvertBase} from '@sharpforge/bytecode';
import {enumTypes} from '@sharpforge/framework';
import {numeric, binaryPromotion, unaryPromotion} from '../numeric.js';

function convert(emitter, from, to, checked = false) {
  if (from !== to) emitter.emit(Op.CONVERT, NumericType[to], numericMode(from, checked));
}

/** Emits promoted operands already selected by the binder, with explicit source scalar mode. */
export function emitScalarBinary(emitter, operator, types, checked) {
  const {left, right, promoted = binaryPromotion(left, right, operator)} = types;
  if (!promoted) return null;
  const shift = ['<<', '>>', '>>>'].includes(operator), rightType = shift ? 'int' : promoted;
  if (left !== promoted) {
    const saved = emitter.temp(right);
    emitter.emit(Op.STLOC, saved); emitter.emit(Op.POP);
    convert(emitter, left, promoted);
    emitter.emit(Op.LDLOC, saved);
  }
  convert(emitter, right, rightType);
  emitter.emit(Op.BINARY, Binary[operator], numericMode(promoted, checked));
  return promoted;
}

export function emitScalarExpression(emitter, node) {
  if (node.kind === 'Conversion' && (numeric(node.legacyType) || enumTypes.includes(node.legacyType))) {
    emitter.expr(node.operand);
    const target = enumTypes.indexOf(node.legacyType);
    const source = numeric(node.operand.legacyType) ? node.operand.legacyType : 'int';
    emitter.emit(Op.CONVERT, target >= 0 ? EnumConvertBase + target : NumericType[node.legacyType], numericMode(source, node.isChecked));
    return true;
  }
  if (node.kind === 'UnaryOperator' && numeric(node.operand.legacyType)) {
    emitter.expr(node.operand);
    emitter.emit(Op.UNARY, Unary[node.operator], numericMode(node.legacyType, node.isChecked));
    return true;
  }
  if (node.kind === 'BinaryOperator' && numeric(node.left.legacyType) && numeric(node.right.legacyType)) {
    emitter.expr(node.left); emitter.expr(node.right);
    emitScalarBinary(emitter, node.operator, {left: node.left.legacyType, right: node.right.legacyType}, node.isChecked);
    return true;
  }
  if (node.kind === 'IncrementOperator' && numeric(node.legacyType)) {
    const reference = emitter.prepare(node.operand);
    emitter.loadRef(reference);
    const previous = node.isPostfix ? emitter.temp(reference.type) : null;
    if (previous !== null) emitter.emit(Op.STLOC, previous);
    emitter.emitConstant(1);
    const promoted = unaryPromotion(reference.type);
    emitScalarBinary(emitter, node.operator === '++' ? '+' : '-', {left: reference.type, right: 'int', promoted}, node.isChecked);
    convert(emitter, promoted, reference.type, node.isChecked);
    emitter.storeRef(reference);
    if (previous !== null) { emitter.emit(Op.POP); emitter.emit(Op.LDLOC, previous); }
    return true;
  }
  if (node.kind === 'CompoundAssignmentOperator' && numeric(node.legacyType)) {
    const reference = emitter.prepare(node.left);
    emitter.loadRef(reference); emitter.expr(node.right);
    const promoted = emitScalarBinary(emitter, node.operator, {left: reference.type, right: node.right.legacyType}, node.isChecked);
    convert(emitter, promoted, reference.type, node.isChecked);
    emitter.storeRef(reference);
    return true;
  }
  return false;
}
