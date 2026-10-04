import {cilRuntimeEvents} from './cil-method-events.js';
import {RuntimeEventName} from './runtime-events.js';
import {exceptionTypeName} from './exception-types.js';

/** Record an originating slice fault before debugger notification or managed unwinding. */
export function emitCilException(vm, fault, frame, instruction, fatal) {
  const log = cilRuntimeEvents(vm);
  if (!log) return;
  // A valid rethrow propagates the existing caught fault, including after snapshot restore.
  // An invalid rethrow instead produces a new InvalidProgramException and must be observed.
  if (instruction?.name === 'rethrow' && frame?.caught?.some(caught =>
    caught.fault === fault && instruction.offset >= caught.start && instruction.offset < caught.end)) return;
  const name = typeof fault.name === 'string' ? fault.name : 'InvalidProgramException';
  log.emit(RuntimeEventName.ExceptionThrown, {
    name: name.slice(0, 4096), exceptionType: exceptionTypeName(name).slice(0, 4096),
    method: frame?.method?.token ?? null, frame: frame?.id ?? null,
    ilOffset: instruction?.offset ?? null, fatal
  }, vm.instructions);
}
