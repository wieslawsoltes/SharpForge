import { DebugSession, CilDebugSession } from '@sharpforge/debugger';
import { runtimeLaunchCapabilities } from '@sharpforge/runtime';

/** Prepare and bind a candidate before the worker commits it as the current application. */
export function createRuntimeLaunchCandidate(params, { executable, onOutput, onUICommand }) {
  const debug = params.debug !== false;
  const options = {
    network: params.network ?? {}, compute: params.compute ?? {}, environment: params.environment,
    programArguments: params.programArguments, arguments: params.arguments,
    recordHistory: debug && params.recordHistory !== false,
    maxHistory: params.maxHistory, maxHistoryBytes: params.maxHistoryBytes,
    stepOverProperties: params.stepOverProperties === true,
    breakpointsEnabled: params.breakpointsEnabled !== false,
    maxInstructions: params.maxInstructions ?? 20_000_000,
    onOutput, onUICommand
  };
  let candidate;
  if (params.managedIL) {
    candidate = new CilDebugSession(params.assembly, {
      ...options, methodToken: params.methodToken, pdb: params.pdb, sources: params.sources
    });
    candidate.assemblyLoad = { format: 'ECMA-335', cacheHit: false, milliseconds: candidate.vm.loadMs, bytes: params.assembly.length };
    if (debug) candidate.setInstructionBreakpoints(params.instructionBreakpoints ?? []);
  } else {
    const module = executable(params);
    candidate = new DebugSession(module.image, options);
    candidate.assemblyLoad = module.load;
  }
  if (debug) {
    for (const [uri, breakpoints] of Object.entries(params.breakpoints ?? {})) candidate.setBreakpoints(uri, breakpoints);
    candidate.setFunctionBreakpoints(params.functionBreakpoints ?? []);
    candidate.setExceptionBreakpoints({ mode: params.exceptionBreak ?? 'uncaught', rules: params.exceptionRules ?? [] });
  }
  if (params.runToCursor) {
    if (params.managedIL) throw new Error('Use run-to-instruction for managed IL');
    candidate.runToCursor(params.runToCursor.uri, params.runToCursor.line, params.runToCursor.column);
  } else candidate.start(debug && params.stopOnEntry === true);
  return { candidate, capabilities: runtimeLaunchCapabilities };
}
