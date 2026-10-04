import {deoptWasmFrames} from '@sharpforge/runtime';
import {ruleState} from './breakpoint-rules.js';

/** Preserve the existing instruction loop and history, marking stops before host observers. */
export function pumpCilSession(session, options) {
  try {
    const result = session.vm.runSlice({...options, onInstruction: (instruction, frame) => {
      const stop = session.instruction(instruction, frame);
      if (stop) {
        deoptWasmFrames(session.vm);
        session.stoppedBeforeInstruction = true;
        const latest = session.history.at(-1);
        if (latest) {
          latest.stop = {...session.reason};
          latest.stoppedRules = [...session.breakpoints, ...session.functionBreakpoints, ...session.dataBreakpoints].map(ruleState);
        }
      }
      return stop;
    }});
    session.rememberStop();
    return result;
  } finally {
    // Covers suspended stops even if a deferred host observer throws.
    if (session.vm.state === 'paused') deoptWasmFrames(session.vm);
  }
}

export function pauseCilSession(session) {
  if (!['running', 'waiting'].includes(session.vm.state)) return;
  session.vm.state = 'paused';
  deoptWasmFrames(session.vm);
  session.stoppedBeforeInstruction = false;
  session.temporary = null;
  session.reason = {reason: 'pause', phase: 'suspended', description: 'Execution interrupted between IL instructions'};
}
