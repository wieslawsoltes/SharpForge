import {DiagnosticId} from '../diagnostics/codes.js';
import { Op, Binary, Unary } from '@sharpforge/bytecode';
import { numeric, isReference, assignable, typeText } from '../type-utils.js';

export function emitSwitchExpression(node) {
  return this.switchExpression(node);
}

export function emitBinary(node) {
  if (['&&', '||', '??'].includes(node.operator)) {
    const lt = this.expr(node.left);
    this.emit(Op.DUP);
    let jump;
    if (node.operator === '??') {
      if (!isReference(lt) && lt !== 'null' && lt !== 'error')
        this.c.report(node, DiagnosticId.CS0019, ['??', typeText(lt), typeText(this.infer(node.right))]);
      this.emitConstant(null);
      this.emit(Op.BINARY, Binary['!=']);
      jump = this.emit(Op.JTRUE);
    }
    else {
      this.checkAssign('bool', lt, node.left);
      jump = this.emit(node.operator === '&&' ? Op.JFALSE : Op.JTRUE);
    }
    this.emit(Op.POP);
    const beforeRight = new Set(this.assigned);
    const rt = this.expr(node.right);
    this.assigned = beforeRight;
    if (node.operator !== '??')
      this.checkAssign('bool', rt, node.right);
    else if (lt !== 'null')
      this.checkAssign(lt, rt, node);
    this.patch(jump);
    return node.operator === '??' ? (lt === 'null' ? rt : lt) : 'bool';
  }
  const left = this.expr(node.left);
  const right = this.expr(node.right);
  return this.binary(node.operator, left, right, node);
}

export function emitUnary(node) {
  if (['++', '--'].includes(node.operator)) {
    const ref = this.prepare(node.operand);
    this.loadRef(ref);
    const previous = node.postfix ? this.temp(ref.type) : null;
    if (previous !== null) {
      this.emit(Op.STLOC, previous);
    }
    this.emitConstant(1);
    this.binary(node.operator === '++' ? '+' : '-', ref.type, 'int', node);
    this.storeRef(ref);
    if (previous !== null) {
      this.emit(Op.POP);
      this.emit(Op.LDLOC, previous);
    }
    return ref.type;
  }
  if (node.operator === '-' && node.operand.kind === 'Literal' && node.operand.type === 'int' && node.operand.value === 2147483648) {
    this.emitConstant(-2147483648);
    return 'int';
  }
  const type = this.expr(node.operand);
  if (node.operator === '!')
    this.checkAssign('bool', type, node);
  else if (!numeric(type))
    this.c.report(node, DiagnosticId.CS0023, [node.operator, typeText(type)]);
  if (node.operator === '~')
    this.checkAssign('int', type, node);
  this.emit(Op.UNARY, Unary[node.operator], type === 'int' ? (this.overflowChecked(node) && node.operator === '-' ? 5 : 1) : 0);
  return node.operator === '!' ? 'bool' : type;
}

export function emitAssignment(node) {
  const ref = this.prepare(node.left, node.operator === '=');
  if (node.operator === '??=') {
    if (!isReference(ref.type))
      this.c.report(node, DiagnosticId.CS0019, ['??=', typeText(ref.type), typeText(this.infer(node.right))]);
    this.loadRef(ref);
    this.emit(Op.DUP);
    this.emitConstant(null);
    this.emit(Op.BINARY, Binary['==']);
    const done = this.emit(Op.JFALSE);
    this.emit(Op.POP);
    this.checkAssign(ref.type, this.typedExpr(node.right, ref.type), node);
    this.storeRef(ref);
    this.patch(done);
    return ref.type;
  }
  if (node.operator === '=') {
    const type = this.typedExpr(node.right, ref.type);
    this.checkAssign(ref.type, type, node);
  }
  else {
    this.loadRef(ref);
    const type = this.expr(node.right);
    const result = this.binary(node.operator.slice(0, -1), ref.type, type, node);
    this.checkAssign(ref.type, result, node);
  }
  this.storeRef(ref);
  return ref.type;
}

export function emitConditional(node) {
  this.bool(node.condition);
  const before = new Set(this.assigned);
  const no = this.emit(Op.JFALSE);
  const yesType = this.expr(node.whenTrue);
  const yesAssigned = new Set(this.assigned);
  const done = this.emit(Op.JUMP);
  this.patch(no);
  this.assigned = new Set(before);
  const noType = this.expr(node.whenFalse);
  this.assigned = new Set([...yesAssigned].filter(s => this.assigned.has(s)));
  this.patch(done);
  if (!assignable(yesType, noType) && !assignable(noType, yesType))
    this.c.report(node, DiagnosticId.CS0173, [typeText(yesType), typeText(noType)]);
  return yesType === 'null' ? noType : yesType === 'double' || noType === 'double' ? 'double' : yesType;
}
