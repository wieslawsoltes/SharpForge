import {
  Op
} from '@sharpforge/bytecode';
import {
  exceptionTypeName
} from '../symbols/exception-identity.js';

/** Emit independent filter bodies before catch entries; both share the declared exception local. */
export function emitTryCatch(emitter, node) {
  const start = emitter.pc;
  emitter.stmt(node.tryBlock);
  if (emitter.pc === start) emitter.emit(Op.NOP);
  const end = emitter.pc;
  const jumps = [emitter.emit(Op.JUMP)];
  for (const clause of node.catchBlocks) {
    const type = exceptionTypeName(clause.exceptionType);
    let slot = emitter.temp(type);
    if (clause.local) {
      const local = emitter.declare(clause.local);
      local.scopeEnd = clause.body.syntax.end;
      slot = local.slot;
    }
    const handler = {
      start,
      end,
      target: 0,
      handlerEnd: 0,
      slot,
      type
    };
    if (clause.filter) {
      handler.filter = emitter.pc;
      emitter.expr(clause.filter);
      emitter.emit(Op.ENDFILTER);
    }
    handler.target = emitter.pc;
    emitter.handlers.push(handler);
    emitter.stmt(clause.body);
    jumps.push(emitter.emit(Op.JUMP));
    handler.handlerEnd = emitter.pc;
    emitter.closeScope(clause.local ? [clause.local] : []);
  }
  for (const jump of jumps) emitter.patch(jump);
}
