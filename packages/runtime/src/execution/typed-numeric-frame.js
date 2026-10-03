import {typedNumericSlots} from './typed-stack.js';

const frames = new WeakMap();

/**
 * Attach private numeric planes on first execution or after restoring plain array
 * snapshots. Filters sharing locals receive the same proxy and storage plane.
 */
export function ensureTypedNumericFrame(vm, frame, plan) {
  const smallLongs = vm.options.smallLongFastPath === true;
  if (!plan.typedNumericSlots || vm.options.typedNumericStack !== true && !smallLongs) return;
  const cached = frames.get(frame);
  if (cached?.method === frame.method && cached.stack === frame.stack &&
      cached.locals === frame.locals && cached.args === frame.args) return;
  const stack = typedNumericSlots(frame.stack, frame.method.maxStack, frame.method.maxStack, smallLongs, true);
  const locals = typedNumericSlots(frame.locals, undefined, undefined, smallLongs);
  const args = typedNumericSlots(frame.args, undefined, undefined, smallLongs);
  frame.stack = stack.array;
  frame.locals = locals.array;
  frame.args = args.array;
  frames.set(frame, {method: frame.method, stack: stack.array, locals: locals.array, args: args.array});
}

/** Frame pools can drop the identity cache before replacing a frame's arrays. */
export function releaseTypedNumericFrame(frame) {
  frames.delete(frame);
}
