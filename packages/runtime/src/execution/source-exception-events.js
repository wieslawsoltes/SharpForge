import {Op} from '@sharpforge/bytecode';
import {sourceRuntimeEvents} from './source-runtime-events.js';
import {RuntimeEventName} from './runtime-events.js';
import {exceptionTypeName} from './exception-types.js';

/** Origin boundary only; existing unwind/pending-fault paths do not call this observer. */
export function emitSourceException(vm, fault, instruction, fatal) {
  const log = sourceRuntimeEvents(vm);
  if (!log) return;
  const {frame, opcode, index} = instruction;
  // The caught fault is canonical even when copied by a snapshot; explicit throw creates a new origin.
  if (opcode === Op.RETHROW && frame.caught?.some(caught =>
    caught.fault === fault && index >= caught.start && index < caught.end)) return;
  const name = typeof fault.name === 'string' ? fault.name : 'RuntimeException';
  log.emit(RuntimeEventName.ExceptionThrown, {
    name: name.slice(0, 4096), exceptionType: exceptionTypeName(name).slice(0, 4096),
    method: instruction.method, frame: instruction.frameId, instructionIndex: index, fatal
  }, vm.instructions);
}
