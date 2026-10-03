import {typedNumericSlots} from './typed-stack.js';

const frames = new WeakMap();

/**
 * Attach private numeric planes on first execution or after restoring plain array
 * snapshots. Filters sharing locals receive the same proxy and storage plane.
 */
export function ensureTypedNumericFrame(vm, frame, plan) {
  if (!plan.typedNumericSlots || vm.options.typedNumericStack !== true) return;
  const cached = frames.get(frame);
  if (cached?.method === frame.method && cached.stack === frame.stack &&
      cached.locals === frame.locals && cached.args === frame.args) return;
  const stack = typedNumericSlots(frame.stack, frame.method.maxStack ?? 8, vm.options.maxStackValues);
  const locals = typedNumericSlots(frame.locals);
  const args = typedNumericSlots(frame.args);
  frame.stack = stack.array;
  frame.locals = locals.array;
  frame.args = args.array;
  frames.set(frame, {method: frame.method, stack: stack.array, locals: locals.array, args: args.array});
}

/** Frame pools can drop the identity cache before replacing a frame's arrays. */
export function releaseTypedNumericFrame(frame) {
  frames.delete(frame);
}
