import {float} from '../numeric-ops.js';
import {numericSlots, NumericSlotTag} from '../typed-stack.js';
import {invokeWasmHost} from './heap-bridge.js';

function frame(context) {
  if (!context.active || context.vm.top !== context.frame) throw new Error('Wasm numeric import outside its active frame');
  return context.frame;
}

function popFloat(context) {
  const stack = frame(context).stack;
  const slots = numericSlots(stack);
  return slots ? slots.popNumber() : context.vm.pop().value;
}

function pushFloat(context, value, tag) {
  const stack = frame(context).stack;
  const slots = numericSlots(stack);
  if (slots) slots.pushFloat(value, tag);
  else context.vm.push(float(value, tag === NumericSlotTag.r4 ? 'r4' : 'r8'));
}

/** Imports close over a private active-call context, never over a snapshot frame. */
export function createWasmImports(context) {
  return {runtime: {
    pop_i32: () => { frame(context); return context.vm.pop(); },
    pop_i64: () => { frame(context); return context.vm.pop(); },
    pop_f32: () => popFloat(context),
    pop_f64: () => popFloat(context),
    push_i32: value => { frame(context); context.vm.push(value); },
    push_i64: value => { frame(context); context.vm.push(value); },
    push_f32: value => pushFloat(context, value, NumericSlotTag.r4),
    push_f64: value => pushFloat(context, value, NumericSlotTag.r8),
    allocate: pc => invokeWasmHost(context, pc, 'allocate'),
    field: pc => invokeWasmHost(context, pc, 'field'),
    array: pc => invokeWasmHost(context, pc, 'array'),
    call: pc => invokeWasmHost(context, pc, 'call'),
    host: pc => invokeWasmHost(context, pc, 'host'),
  }};
}
