import {float} from '../numeric-ops.js';
import {scalarStorageGuard} from '../scalar-storage-plan.js';
import {activeWasmFrame, invokeWasmHost} from './heap-bridge.js';

const guards = Object.freeze({i32: scalarStorageGuard('int'), i64: scalarStorageGuard('long'),
  f32: scalarStorageGuard('float'), f64: scalarStorageGuard('double')});

function pop(context, floating = false) {
  activeWasmFrame(context);
  const value = context.vm.pop();
  return floating ? value.value : value;
}

function push(context, value, kind = null) {
  activeWasmFrame(context);
  context.vm.push(kind ? float(value, kind) : value);
}

/** Helpers retain only an inactive context between instructions; no frame or managed reference is captured. */
export function createWasmImports(context) {
  return {
    guard(pc, inputs) {
      const frame = activeWasmFrame(context, pc);
      const start = frame.stack.length - inputs.length;
      if (start < 0) return false;
      for (let index = 0; index < inputs.length; index++) {
        if (!guards[inputs[index]]?.(frame.stack[start + index], context.vm.options)) return false;
      }
      return true;
    },
    pop_i32: () => pop(context), pop_i64: () => pop(context),
    pop_f32: () => pop(context, true), pop_f64: () => pop(context, true),
    push_i32: value => push(context, value), push_i64: value => push(context, value),
    push_f32: value => push(context, value, 'r4'), push_f64: value => push(context, value, 'r8'),
    allocate: pc => invokeWasmHost(context, pc, 'allocate'),
    field: pc => invokeWasmHost(context, pc, 'field'),
    array: pc => invokeWasmHost(context, pc, 'array'),
    call: pc => invokeWasmHost(context, pc, 'call'),
    host: pc => invokeWasmHost(context, pc, 'host')
  };
}
