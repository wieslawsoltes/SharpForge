import {wasmHostImport} from './encoding-profile.js';

/** Imports are valid only during the current canonical instruction, never across a pooled frame's reuse. */
export function activeWasmFrame(context, pc = context.index) {
  const {vm, frame} = context;
  if (!context.active || !vm || vm.top !== frame || frame.id !== context.frameId ||
      frame.method !== context.method || pc !== context.index || frame.pc !== pc + 1) {
    throw new TypeError('Wasm runtime import is outside its active instruction');
  }
  return frame;
}

/** Heap/call effects retain their authoritative CIL rooting, barrier and debugger notification paths. */
export function invokeWasmHost(context, pc, kind) {
  const frame = activeWasmFrame(context, pc);
  if (wasmHostImport(context.instruction.name) !== kind) throw new TypeError('Wasm host import category mismatch');
  return context.handler(context.vm, frame, context.instruction);
}
