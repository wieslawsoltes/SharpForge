import {snapshotInteger as integer, invalidSnapshot as fail, terminalContext, snapshotFault} from './snapshot-validation-helpers.js';

function validateCilFrame(vm, frame) {
  const method = frame.method;
  if (!method || !Array.isArray(method.instructions) || !Array.isArray(frame.args) ||
      !Array.isArray(frame.stack) || frame.pc > method.instructions.length) fail('CIL frame');
  let original;
  try { original = vm.inspector.getMethod(method.token); } catch { fail('method identity'); }
  if (original.instructions !== method.instructions || original.handlers !== method.handlers) fail('method code generation');
  if (!(frame.offsets instanceof Map) || frame.offsets.size !== original.instructions.length ||
      original.instructions.some((instruction, index) => frame.offsets.get(instruction.offset) !== index)) fail('method offsets');
  if (frame.locals.length !== method.locals.length) fail('method local storage');
}

function validateSourceFrame(vm, frame) {
  const method = vm.image.methods[frame.methodId];
  if (!method || frame.pc > method.code.length / 3 || !integer(frame.base) ||
      frame.locals.length < method.locals.length) fail('source frame');
}

/** Identity checks include parked contexts, but completed frames do not acquire new lifetimes. */
export function validateSnapshotFrames(vm, snapshot, engine) {
  const all = new Map(), ownership = new Map();
  const visit = (frames, owner) => {
    if (!Array.isArray(frames)) fail('frames');
    const ids = new Set();
    for (const frame of frames) {
      if (!frame || !integer(frame.id) || frame.id === 0 || ids.has(frame.id) ||
          !integer(frame.pc) || !Array.isArray(frame.locals) || frame.id > snapshot.frameId) fail('frame identity');
      ids.add(frame.id);
      if (all.has(frame.id) && all.get(frame.id) !== frame) fail('duplicate frame identity');
      if (ownership.has(frame.id) && ownership.get(frame.id) !== owner) fail('frame context ownership');
      ownership.set(frame.id, owner);
      all.set(frame.id, frame);
      if (engine === 'cil') validateCilFrame(vm, frame);
      else validateSourceFrame(vm, frame);
      if (frame.objectStringReturn !== undefined && frame.objectStringReturn !== true) fail('Object.ToString return continuation');
      for (const prefix of ['readonlyAccess', 'volatileAccess', 'tailCall']) {
        if (frame[prefix] !== undefined && typeof frame[prefix] !== 'boolean') fail('frame prefix');
      }
      snapshotFault(frame.exception);
    }
  };
  const scheduler = snapshot.scheduler;
  const activeOwner = scheduler && !scheduler.parked ? scheduler.currentId : 0;
  visit(snapshot.frames, activeOwner);
  for (const [id, context] of scheduler?.contexts ?? []) {
    if (terminalContext(context.status)) continue;
    visit(context.frames, id);
  }
  for (const frame of all.values()) {
    if (frame.filterOwnerId !== undefined && frame.filterOwnerId !== null) {
      const owner = all.get(frame.filterOwnerId);
      if (!owner || frame.locals !== owner.locals || engine === 'cil' && frame.args !== owner.args) fail('filter storage aliases');
    }
  }
  return all;
}
