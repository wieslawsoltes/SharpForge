import {Op} from '@sharpforge/bytecode';
import {sourceLoadStoreHandlers} from './source-ops/load-store.js';
import {sourceArithmeticHandlers} from './source-ops/arithmetic.js';
import {sourceControlHandlers} from './source-ops/control.js';

function advance(vm, frame) {
  frame.pc++;
  vm.instructions++;
}

function finish(vm, frame, group) {
  if (!group.tail) return;
  advance(vm, frame);
  if (group.tail === Op.STLOC) sourceLoadStoreHandlers[Op.STLOC](vm, frame, group.target);
  else if (group.tail === Op.JFALSE) sourceControlHandlers[Op.JFALSE](vm, frame, group.target);
  else sourceControlHandlers[Op.JTRUE](vm, frame, group.target);
  if (group.discard) {
    advance(vm, frame);
    sourceLoadStoreHandlers[Op.POP](vm, frame);
  }
}

/** Reuse the released handlers at fixed call sites, preserving partial stacks on every fault. */
export function executeLocalBinary(vm, frame, group) {
  advance(vm, frame);
  sourceLoadStoreHandlers[Op.LDLOC](vm, frame, group.left);
  advance(vm, frame);
  if (group.constant) sourceLoadStoreHandlers[Op.CONST](vm, frame, group.right);
  else sourceLoadStoreHandlers[Op.LDLOC](vm, frame, group.right);
  advance(vm, frame);
  sourceArithmeticHandlers[Op.BINARY](vm, frame, group.operator, group.mode);
  finish(vm, frame, group);
}

export function executeCompareBranch(vm, frame, group) {
  advance(vm, frame);
  sourceArithmeticHandlers[Op.BINARY](vm, frame, group.operator, group.mode);
  finish(vm, frame, group);
}
