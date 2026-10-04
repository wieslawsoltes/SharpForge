import {typedFloatArray} from './typed-stack.js';

/** Called before a newly allocated frame becomes observable to host callbacks. */
export function initializeFloatFrame(vm, frame, capacity) {
  const smallLongs = vm.options.smallLongs === true;
  if (vm.options.typedNumericStack !== true && !smallLongs && vm.options.specializeNumericHandlers !== true) return;
  frame.stack = typedFloatArray(frame.stack, capacity, smallLongs);
  frame.locals = typedFloatArray(frame.locals, frame.locals.length, smallLongs);
  frame.args = typedFloatArray(frame.args, frame.args.length, smallLongs);
}

/** Restore publishes ordinary snapshots as fresh runtime-owned arrays, preserving shared local aliases. */
export function restoreFloatFrames(vm) {
  const smallLongs = vm.options.smallLongs === true;
  if (!vm.inspector || vm.options.typedNumericStack !== true && !smallLongs && vm.options.specializeNumericHandlers !== true) return;
  const arrays = new WeakMap();
  const wrap = (values, capacity) => {
    let result = arrays.get(values);
    if (!result) {
      result = typedFloatArray(values, capacity, smallLongs);
      arrays.set(values, result);
    }
    return result;
  };
  const frames = new Set(vm.frames);
  for (const context of vm.scheduler.contexts.values()) for (const frame of context.frames) frames.add(frame);
  for (const frame of frames) {
    const capacity = Math.min(frame.method.maxStack, vm.options.maxStackValues ?? 65536);
    frame.stack = wrap(frame.stack, capacity);
    frame.locals = wrap(frame.locals, frame.locals.length);
    frame.args = wrap(frame.args, frame.args.length);
  }
}
