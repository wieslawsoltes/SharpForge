import {DiagnosticId} from '../diagnostics/codes.js';
import { Op } from '@sharpforge/bytecode';

export function compileThrow(node) {
  this.seq(node);
  if (node.expression) {
    const type = this.expr(node.expression);
    if (type !== 'Exception' && type !== 'null' && type !== 'error')
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
    if (type !== 'Exception')
      this.c.report(node, DiagnosticId.SF2002);
    const slot = this.temp('Exception');
    if (ca.name) {
      const l = this.local(ca.name, 'Exception', { ...ca.body, name: ca.name, nameSpan: ca.nameSpan }, true);
      l.scopeEnd = ca.body.end;
      this.locals[slot].hidden = true;
      this.handlers.push({ start, end, target: this.pc, slot: l.slot, type });
    }
    else
      this.handlers.push({ start, end, target: this.pc, slot, type });
    this.catchDepth++;
    this.stmt(ca.body);
    this.catchDepth--;
    jumps.push(this.emit(Op.JUMP));
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
