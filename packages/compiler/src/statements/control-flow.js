import {DiagnosticId} from '../diagnostics/codes.js';
import { Op } from '@sharpforge/bytecode';
import { typeText } from '../type-utils.js';

export function compileIf(node) {
  this.seq({ ...node, end: node.condition.end });
  this.bool(node.condition);
  const jump = this.emit(Op.JFALSE);
  const before = new Set(this.assigned);
  this.stmt(node.then);
  const then = new Set(this.assigned);
  const end = this.emit(Op.JUMP);
  this.patch(jump);
  this.assigned = new Set(before);
  this.stmt(node.otherwise);
  this.assigned = new Set([...then].filter(s => this.assigned.has(s)));
  this.patch(end);
  return;
}

export function compileLoop(node) {
  this.scopes.push(new Map());
  if (node.init) {
    if (node.init.kind === 'Local')
      this.stmt(node.init);
    else {
      this.seq(node.init);
      this.expr(node.init);
      this.emit(Op.POP);
    }
  }
  const before = new Set(this.assigned);
  const start = this.pc;
  const loop = { breaks: [], continues: [], labels: node.labels ?? [] };
  this.loops.push(loop);
  let exit;
  if (node.kind !== 'Do') {
    this.seq(node.condition ?? node);
    if (node.condition) {
      this.bool(node.condition);
      exit = this.emit(Op.JFALSE);
    }
  }
  this.stmt(node.body);
  const continuePc = this.pc;
  for (const p of loop.continues)
    this.patch(p, continuePc);
  if (node.increment) {
    this.seq(node.increment);
    this.expr(node.increment);
    this.emit(Op.POP);
  }
  if (node.kind === 'Do') {
    this.seq(node.condition);
    this.bool(node.condition);
    this.emit(Op.JTRUE, start);
  }
  else
    this.emit(Op.JUMP, start);
  if (exit !== undefined)
    this.patch(exit);
  for (const p of loop.breaks)
    this.patch(p);
  this.loops.pop();
  this.closeScope();
  this.assigned = before;
  return;
}

export function compileLoopJump(node) {
  this.seq(node);
  if (node.label)
    this.c.requireFeature(node, 15, 'Labeled break and continue');
  const loop = node.label
    ? [...this.loops].reverse().find(l => l.labels?.includes(node.label) && (node.kind !== 'Continue' || !l.switch))
    : node.kind === 'Continue' ? [...this.loops].reverse().find(l => !l.switch) : this.loops.at(-1);
  if (loop && this.finallyScopes.length && !this.loops.slice(this.finallyScopes.at(-1)).includes(loop))
    this.c.report(node, DiagnosticId.CS0157);
  if (!loop)
    this.c.report(node, DiagnosticId.CS0139);
  else
    loop[node.kind === 'Break' ? 'breaks' : 'continues'].push(this.emit(Op.JUMP));
  return;
}

export function compileSwitch(node) {
  this.switchStatement(node);
  return;
}

export function compileReturn(node) {
  if (this.finallyScopes.length)
    this.c.report(node, DiagnosticId.CS0157);
  this.seq(node);
  if (node.expression) {
    const type = this.typedExpr(node.expression, this.m.returnType);
    this.checkAssign(this.m.returnType, type, node);
  }
  else {
    if (this.m.returnType !== 'void')
      this.c.report(node, DiagnosticId.CS0126, [typeText(this.m.returnType)]);
    this.emitConstant(null);
  }
  this.emit(Op.RET);
  return;
}
