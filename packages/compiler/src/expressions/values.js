import {DiagnosticId} from '../diagnostics/codes.js';
import { enumTypes, frameworkType, findContracts } from '@sharpforge/framework';
import { Op, Binary, frameworkBuiltin, EnumConvertBase } from '@sharpforge/bytecode';
import { numeric, defaultValue, typeText } from '../type-utils.js';

export function emitInterpolatedString(node) {
  this.emitConstant('');
  const format = findContracts('SharpForge.Runtime.Formatting', 'FormatValue', true)[0];
  for (const part of node.parts) {
    if (part.text !== undefined)
      this.emitConstant(part.text);
    else {
      const type = this.expr(part.expression);
      if (type === 'void')
        this.c.report(part.expression, DiagnosticId.CS0029, ['void', 'object']);
      if (part.alignmentExpression) {
        const width = this.constant(part.alignmentExpression);
        if (!width || width.type !== 'int')
          this.c.report(part.alignmentExpression, DiagnosticId.CS0150);
      }
      this.emitConstant(part.format);
      this.emitConstant(part.alignment);
      this.emitConstant(type);
      this.emitContract(format);
    }
    this.emit(Op.BINARY, Binary['+'], 2);
  }
  return 'string';
}

export function emitAwait(node) {
  if (!this.m.node.asyncBody && !this.m.name.startsWith('<startup>'))
    this.c.report(node, DiagnosticId.CS4032, [typeText(this.m.returnType)]);
  const type = this.expr(node.expression);
  const d = findContracts('SharpForge.Runtime.Async', 'Await', true).find(x => x.parameters[0] === type);
  if (!d) {
    this.c.report(node, DiagnosticId.CS1061, [typeText(type), 'GetAwaiter']);
    return 'error';
  }
  const builtin = frameworkBuiltin(d);
  this.emit(Op.BUILTIN, builtin.id, 1);
  return d.result;
}

export function emitDefault(node) {
  const type = this.c.resolveType(node.type, node, false, this.m);
  if (type === 'void')
    this.c.report(node, DiagnosticId.CS1547);
  this.emitConstant(defaultValue(type), type);
  return type;
}

export function emitOverflowContext(node) {
  const previous = this.checkedContext;
  this.checkedContext = node.kind === 'Checked';
  try {
    return this.expr(node.expression);
  }
  finally {
    this.checkedContext = previous;
  }
}

export function emitCast(node) {
  const from = this.expr(node.expression);
  const to = this.c.resolveType(node.type, node, false, this.m);
  const enumTarget = enumTypes.indexOf(to);
  if ((!numeric(from) && frameworkType(from)?.kind !== 'enum') || (!numeric(to) && enumTarget < 0))
    this.c.report(node, DiagnosticId.CS0030, [typeText(from), typeText(to)]);
  const folded = this.constant(node);
  if (folded && numeric(to)) {
    this.emit(Op.POP);
    this.emitConstant(folded.value, to);
  }
  else
    this.emit(Op.CONVERT, enumTarget >= 0 ? EnumConvertBase + enumTarget : to === 'int' ? 0 : 1, this.overflowChecked(node) && to !== 'double' ? 1 : 0);
  return to;
}

export function emitError(node) {
  this.emitConstant(null);
  return 'error';
}

export function emitLiteral(node) {
  if (node.type === 'char')
    this.c.report(node, DiagnosticId.SF2003);
  if (node.type === 'int' && node.value > 2147483647 && !this.c.reportedAt(node, DiagnosticId.SF1004))
    this.c.report(node, DiagnosticId.SF2004);
  this.emitConstant(node.value, node.type);
  return node.type;
}

export function emitUnknown(node) {
  this.c.report(node, DiagnosticId.SF2098, [node.kind]);
  this.emitConstant(null);
  return 'error';
}
