import {typedFloatArray} from './typed-stack.js';

/** Called before a newly allocated frame becomes observable to host callbacks. */
export function initializeFloatFrame(vm, frame, capacity) {
  if (vm.options.typedNumericStack !== true) return;
  frame.stack = typedFloatArray(frame.stack, capacity);
  frame.locals = typedFloatArray(frame.locals);
  frame.args = typedFloatArray(frame.args);
}

/** Restore publishes ordinary snapshots as fresh runtime-owned arrays, preserving shared local aliases. */
export function restoreFloatFrames(vm) {
  if (!vm.inspector || vm.options.typedNumericStack !== true) return;
  const arrays = new WeakMap();
  const wrap = (values, capacity) => {
    let result = arrays.get(values);
    if (!result) {
      result = typedFloatArray(values, capacity);
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
