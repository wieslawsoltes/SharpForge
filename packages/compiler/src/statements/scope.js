import {DiagnosticId} from '../diagnostics/codes.js';
import { Op } from '@sharpforge/bytecode';
import { isReference } from '../type-utils.js';

export function compileBlock(node) {
  const previous = this.scopeNode;
  this.scopeNode = node;
  this.scopes.push(new Map());
  this.statementList(node.statements);
  for (const local of this.scopes.at(-1).values())
    if (isReference(local.type))
      this.clear(local.slot);
  this.closeScope();
  this.scopeNode = previous;
  return;
}

export function compileEmpty(node) {
  return;
}

export function compileUsing(node) {
  this.stmt(this.lowerUsing(node));
  return;
}

export function compileUsingDeclaration(node) {
  this.c.report(node, DiagnosticId.CS1023);
  return;
}

export function compileLocal(node) {
  this.seq(node);
  if (node.declarations.some(d => d.isConst && d.type === 'var'))
    this.c.report(node, DiagnosticId.CS0822);
  if (node.declarations.length > 1 && node.declarations.some(d => d.type === 'var'))
    this.c.report(node, DiagnosticId.CS0819);
  for (const d of node.declarations) {
    let declared = this.c.resolveType(d.type, d, true, this.m);
    let initType;
    if (d.initializer)
      initType = this.typedExpr(d.initializer, declared === 'var' ? null : declared);
    if (declared === 'var') {
      if (!d.initializer || initType === 'null' || initType === 'void')
        this.c.report(d, DiagnosticId.CS0818);
      declared = initType ?? 'error';
    }
    if (declared === 'void')
      this.c.report(d, DiagnosticId.CS1547);
    const l = this.local(d.name, declared, d, false, !!d.hidden);
    if (d.initializer) {
      this.checkAssign(declared, initType, d);
      this.emit(Op.STLOC, l.slot);
      this.emit(Op.POP);
      this.assigned.add(l.slot);
    }
    if (d.isConst && !d.initializer)
      this.c.report(d, DiagnosticId.CS0145);
    else if (d.isConst) {
      const value = this.constant(d.initializer);
      if (!value)
        this.c.report(d, DiagnosticId.CS0133, [d.name]);
      else
        l.constantValue = { ...value, type: declared };
    }
  }
  return;
}

export function compileExpressionStatement(node) {
  this.seq(node);
  this.expr(node.expression);
  this.emit(Op.POP);
  if (!['Call', 'Await', 'Assignment', 'New'].includes(node.expression.kind) &&
      !(node.expression.kind === 'Unary' && ['++', '--'].includes(node.expression.operator)))
    this.c.report(node, DiagnosticId.CS0201);
  return;
}

export function compileOverflowContext(node) {
  const previous = this.checkedContext;
  this.checkedContext = node.checked;
  try {
    this.stmt(node.body);
  }
  finally {
    this.checkedContext = previous;
  }
  return;
}
