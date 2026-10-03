import {Op, Unary, NumericType, numericMode, EnumConvertBase} from '@sharpforge/bytecode';
import {enumTypes, frameworkType} from '@sharpforge/framework';
import {numeric, integral, unaryPromotion, binaryPromotion, constantFits} from './numeric.js';

export function negativeMinimum(node) {
  if (node?.kind !== 'Unary' || node.operator !== '-' || node.operand.kind !== 'Literal') return null;
  const {type, value, literalText = ''} = node.operand;
  if (type === 'int' && value === 2147483648 || type === 'uint' && value?.value === '2147483648' && !/[uUlL]$/.test(literalText)) {
    return {type: 'int', value: -2147483648};
  }
  if (type === 'ulong' && value?.value === '9223372036854775808' && !/[uU]/.test(literalText)) {
    return {type: 'long', value: {scalar: 'long', value: '-9223372036854775808'}};
  }
  return null;
}

export function scalarConditionalType(compiler, node) {
  const yes = compiler.infer(node.whenTrue), no = compiler.infer(node.whenFalse);
  if (!numeric(yes) || !numeric(no)) return null;
  if (yes === no) return yes;
  const left = compiler.constant(node.whenTrue), right = compiler.constant(node.whenFalse);
  if (left && constantFits(left.value, left.type, no)) return no;
  if (right && constantFits(right.value, right.type, yes)) return yes;
  if (compiler.scalarAccepts(node.whenFalse, yes, no)) return yes;
  if (compiler.scalarAccepts(node.whenTrue, no, yes)) return no;
  return null;
}

export function inferScalarExpression(compiler, node) {
  const minimum = negativeMinimum(node);
  if (minimum) return minimum.type;
  if (node?.kind === 'Unary') {
    const type = compiler.infer(node.operand);
    if (numeric(type)) return node.operator === '!' ? 'bool' : ['++', '--'].includes(node.operator) ? type : unaryPromotion(type, node.operator);
  }
  if (node?.kind === 'Binary') {
    const left = compiler.infer(node.left), right = compiler.infer(node.right);
    if (!numeric(left) || !numeric(right)) return undefined;
    if (['==', '!=', '<', '>', '<=', '>='].includes(node.operator)) return 'bool';
    return binaryPromotion(left, right, node.operator, compiler.constant(node.left), compiler.constant(node.right)) ?? 'error';
  }
  return undefined;
}

function narrow(compiler, from, to, node) {
  if (numeric(from) && numeric(to) && from !== to) {
    compiler.emit(Op.CONVERT, NumericType[to], numericMode(from, compiler.overflowChecked(node)));
  }
}

export function compileLegacyScalarExpression(compiler, node) {
  if (['Cast','Unary'].includes(node.kind)) compiler.constant(node);
  if (node.kind === 'Cast') {
    const from = compiler.expr(node.expression), to = compiler.c.resolveType(node.type, node, false, compiler.m);
    const enumTarget = enumTypes.indexOf(to);
    if ((!numeric(from) && frameworkType(from)?.kind !== 'enum') || (!numeric(to) && enumTarget < 0)) {
      compiler.c.report(node, 'CS0030', [from, to]);
    }
    compiler.emit(Op.CONVERT, enumTarget >= 0 ? EnumConvertBase + enumTarget : NumericType[to] ?? 0,
      numericMode(numeric(from) ? from : 'int', compiler.overflowChecked(node)));
    return to;
  }
  if (node.kind !== 'Unary' || !numeric(compiler.infer(node.operand))) return undefined;
  if (['++', '--'].includes(node.operator)) {
    const reference = compiler.prepare(node.operand);
    compiler.loadRef(reference);
    const previous = node.postfix ? compiler.temp(reference.type) : null;
    if (previous !== null) compiler.emit(Op.STLOC, previous);
    compiler.emitConstant(1);
    const promoted = compiler.binary(node.operator === '++' ? '+' : '-', reference.type, 'int', node);
    narrow(compiler, promoted, reference.type, node);
    compiler.storeRef(reference);
    if (previous !== null) { compiler.emit(Op.POP); compiler.emit(Op.LDLOC, previous); }
    return reference.type;
  }
  const minimum = negativeMinimum(node);
  if (minimum) { compiler.emitConstant(minimum.value, minimum.type); return minimum.type; }
  const type = compiler.expr(node.operand), promoted = unaryPromotion(type, node.operator);
  if (node.operator === '!' || node.operator === '~' && !integral(type) || node.operator === '-' && ['ulong', 'nuint'].includes(type)) {
    compiler.c.report(node, 'CS0023', [node.operator, type]);
  }
  narrow(compiler, type, promoted, node);
  compiler.emit(Op.UNARY, Unary[node.operator], numericMode(promoted, compiler.overflowChecked(node)));
  return promoted;
}
