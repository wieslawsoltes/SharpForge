import {resumeArrayOperation} from './array-continuations.js';

/** The CIL slice owns quota charging/fault dispatch; a resumed unit keeps the original call offset. */
export function resumeCilArrayContinuation(vm, frame) {
  const profiler = vm.profiler;
  let succeeded = false;
  try {
    profiler?.instruction(frame);
    const result = resumeArrayOperation(vm, frame);
    if (result.done && result.returns) vm.push(result.value);
    succeeded = true;
  } finally { profiler?.endInstruction(succeeded); }
}
