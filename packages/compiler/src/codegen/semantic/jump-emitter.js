/**
 * The IR emitter with labels and jumps to them. State machines resume in the middle of a method body, which the
 * structured statements of the execution profile cannot express; the IR itself has always had plain jumps.
 *
 *   { kind: 'LabelStatement', label }   marks the current position
 *   { kind: 'GotoStatement', label }    jumps to the position of `label` (backwards or forwards)
 *
 * A label is any object; identity names it.
 */
import { Op } from '@sharpforge/bytecode';
import { ProjectReferenceIrEmitter } from './project-reference-emitter.js';

export class JumpIrEmitter extends ProjectReferenceIrEmitter {
  constructor(compilation, method) {
    super(compilation, method);
    this.labelPositions = new Map();
    this.pendingJumps = [];
  }
  stmt(node) {
    if (node?.kind === 'LabelStatement') {
      this.labelPositions.set(node.label, this.pc);
      // A label is a jump target even when nothing follows it in its block.
      this.emit(Op.NOP);
      return;
    }
    if (node?.kind === 'GotoStatement') {
      this.pendingJumps.push({ at: this.emit(Op.JUMP), label: node.label });
      return;
    }
    super.stmt(node);
  }
  finish() {
    for (const jump of this.pendingJumps) {
      const target = this.labelPositions.get(jump.label);
      if (target === undefined) throw new Error('A jump targets a label that was never emitted');
      this.patch(jump.at, target);
    }
    super.finish();
  }
}
