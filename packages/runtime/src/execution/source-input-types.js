import {
  analyzeMethod
} from '@sharpforge/cil';

const analyses = new WeakMap();

/** Cache declared source stack types by immutable code and handler identity. */
export function sourceInputTypes(vm, frame = vm.top, pc = frame.pc - 1) {
  const method = vm.image.methods[frame.methodId];
  let entry = analyses.get(method);
  if (!entry || entry.code !== method.code || entry.handlers !== method.handlers) {
    entry = {
      code: method.code,
      handlers: method.handlers,
      analysis: analyzeMethod(vm.image, method)
    };
    analyses.set(method, entry);
  }
  return entry.analysis.states[pc] ?? [];
}
