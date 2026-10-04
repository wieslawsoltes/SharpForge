import {exceptionTypeName, isExceptionType} from '../symbols/exception-identity.js';
import {DiagnosticId} from '../diagnostics/codes.js';
import { Op } from '@sharpforge/bytecode';

export function compileThrow(node) {
  this.seq(node);
  if (node.expression) {
    const type = this.expr(node.expression);
    if (type !== 'null' && !isExceptionType(this.c, type))
      this.c.report(node, DiagnosticId.CS0155);
    this.emit(Op.THROW);
  }
  else {
    if (!this.catchDepth)
      this.c.report(node, DiagnosticId.CS0156);
    this.emit(Op.RETHROW);
  }
  return;
}

export function compileTry(node) {
  if (node.finallyBody) {
    const start = this.pc;
    const before = new Set(this.assigned);
    if (node.catches.length)
      this.stmt({ ...node, finallyBody: null });
    else
      this.stmt(node.body);
    if (this.pc === start)
      this.emit(Op.NOP);
    const normalAssigned = new Set(this.assigned);
    const end = this.pc;
    const jump = this.emit(Op.JUMP);
    const handler = { kind: 'finally', start, end, target: this.pc, handlerEnd: 0 };
    this.handlers.push(handler);
    this.assigned = new Set(before);
    this.finallyScopes.push(this.loops.length);
    this.stmt(node.finallyBody);
    this.finallyScopes.pop();
    this.emit(Op.ENDFINALLY);
    handler.handlerEnd = this.pc;
    this.patch(jump);
    for (const slot of normalAssigned)
      this.assigned.add(slot);
    return;
  }
  const start = this.pc;
  const before = new Set(this.assigned);
  this.stmt(node.body);
  if (this.pc === start)
    this.emit(Op.NOP);
  const end = this.pc;
  const jumps = [this.emit(Op.JUMP)];
  for (const ca of node.catches) {
    this.scopes.push(new Map());
    this.assigned = new Set(before);
    const type = this.c.resolveType(ca.type, node, false, this.m);
    if (!isExceptionType(this.c, type)) this.c.report(node, DiagnosticId.CS0155);
    let slot = this.temp(type);
    if (ca.name) {
      const local = this.local(ca.name, type, { ...ca.body, name: ca.name, nameSpan: ca.nameSpan }, true);
      local.scopeEnd = ca.body.end;
      this.locals[slot].hidden = true;
      slot = local.slot;
    }
    const handler = {start, end, target: 0, handlerEnd: 0, slot, type: exceptionTypeName(type)};
    if (ca.filter) {
      handler.filter = this.pc;
      this.bool(ca.filter);
      this.emit(Op.ENDFILTER);
    }
    handler.target = this.pc;
    this.handlers.push(handler);
    this.catchDepth++;
    this.stmt(ca.body);
    this.catchDepth--;
    jumps.push(this.emit(Op.JUMP));
    handler.handlerEnd = this.pc;
    this.closeScope();
  }
  for (const jump of jumps)
    this.patch(jump);
  this.assigned = before;
  return;
}

export function compileUnknown(node) {
  this.c.report(node, DiagnosticId.SF2099, [node.kind]);
}
