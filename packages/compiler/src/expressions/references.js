import {DiagnosticId} from '../diagnostics/codes.js';
import { Op, BuiltinMap } from '@sharpforge/bytecode';
import { pathOf, typeText } from '../type-utils.js';

export function emitName(node) {
  const l = this.lookup(node.name);
  if (l) {
    if (!this.assigned.has(l.slot))
      this.c.report(node, DiagnosticId.CS0165, [l.name]);
    if (l.symbol)
      this.c.reference(node, l.symbol);
    this.emit(Op.LDLOC, l.slot);
    return l.type;
  }
  const property = this.property(node);
  if (property)
    return this.readProperty(property, node);
  const f = this.field(node);
  if (f) {
    this.c.reference(node, f.symbol);
    if (f.isStatic)
      this.emit(Op.LDSTATIC, f.index);
    else {
      const self = this.lookup('this');
      if (!self)
        this.c.report(node, DiagnosticId.CS0120, [node.name]);
      this.emit(Op.LDLOC, self?.slot ?? 0);
      this.emit(Op.LDFLD, f.index);
    }
    return f.type;
  }
  this.c.report(node, DiagnosticId.CS0103, [node.name]);
  this.emitConstant(null);
  return 'error';
}

export function emitMember(node) {
  const type = this.infer(node.target);
  if (node.name === 'Length' && (type === 'string' || type.endsWith('[]'))) {
    this.expr(node.target);
    this.emit(Op.LENGTH);
    return 'int';
  }
  if (['Name', 'FullName'].includes(node.name) && type === 'System.Type') {
    this.expr(node.target);
    this.emit(Op.BUILTIN, BuiltinMap.get('Type.' + node.name).id, 1);
    return 'string';
  }
  if (node.name === 'Message' && type === 'Exception') {
    this.expr(node.target);
    this.emit(Op.BUILTIN, BuiltinMap.get('Exception.Message').id, 1);
    return 'string';
  }
  if (pathOf(node) === 'Environment.TickCount' || pathOf(node) === 'System.Environment.TickCount') {
    this.emit(Op.BUILTIN, BuiltinMap.get('Environment.TickCount').id, 0);
    return 'int';
  }
  const property = this.property(node);
  if (property)
    return this.readProperty(property, node);
  const f = this.field(node);
  if (f) {
    this.c.reference(node, f.symbol);
    if (f.isStatic)
      this.emit(Op.LDSTATIC, f.index);
    else {
      this.expr(node.target);
      this.emit(Op.LDFLD, f.index);
    }
    return f.type;
  }
  this.c.report(node, DiagnosticId.CS1061, [typeText(type), node.name]);
  this.emitConstant(null);
  return 'error';
}

export function emitIndex(node) {
  const type = this.expr(node.target);
  const index = this.expr(node.index);
  this.checkAssign('int', index, node.index);
  if (!type.endsWith('[]'))
    this.c.report(node, DiagnosticId.SF2005, [typeText(type)]);
  this.emit(Op.LDELEM);
  return type.endsWith('[]') ? type.slice(0, -2) : 'error';
}
