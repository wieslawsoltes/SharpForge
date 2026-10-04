import {AssemblyInspector, loadAssembly, loadProjectAssembly} from '@sharpforge/cil';
import {createProjectAssemblyInspector, withSourceLaunchArguments, runtimeLaunchCapabilities} from '@sharpforge/runtime';
import {DebugSession, CilDebugSession} from '@sharpforge/debugger';
import {runtimeAssemblyInput, runtimeInputKey, sameSingleAssembly} from './runtime-inputs.js';

function decode(input, managedIL) {
  if (input.dependencies.length) {
    if (managedIL) {
      const inspector = createProjectAssemblyInspector(input.assembly, {dependencies: input.dependencies});
      return {inspector, image: inspector.projectImage, moduleCount: inspector.modules.length};
    }
    const graph = loadProjectAssembly(input.assembly, {dependencies: input.dependencies});
    return {image: graph.image, moduleCount: graph.modules.length};
  }
  const bytes = input.assembly.slice();
  return managedIL ? {bytes, inspector: new AssemblyInspector(bytes), moduleCount: 1}
    : {bytes, image: loadAssembly(bytes), moduleCount: 1};
}

/** Cache one complete execution graph; every launch retains isolated arguments and runtime state. */
export function createRuntimeExecutable() {
  let loaded = null;
  return params => {
    const overlayArguments = params.programArguments === undefined ? params.args ?? [] : [];
    if (!params.assembly) {
      if (params.managedIL || params.dependencies?.length) throw new Error('Project execution requires an entry assembly');
      return {image: withSourceLaunchArguments(params.image, overlayArguments), load: null};
    }
    const started = performance.now();
    const input = runtimeAssemblyInput(params);
    const managedIL = params.managedIL === true;
    const key = input.dependencies.length ? runtimeInputKey(input, managedIL) : null;
    const hit = key ? loaded?.key === key : sameSingleAssembly(loaded, input, managedIL);
    if (!hit) loaded = {...decode(input, managedIL), key, managedIL};
    if (input.dependencies.length && params.pdb) {
      throw new Error('Project assembly graphs use their verified source maps; external symbol replacement requires a single assembly');
    }
    return {image: managedIL ? loaded.image : withSourceLaunchArguments(loaded.image, overlayArguments),
      inspector: loaded.inspector, ...(input.dependencies.length ? {debugOptions: {autoLoadSymbols: false}} : {}),
      load: {format: 'ECMA-335', cacheHit: !!hit, milliseconds: performance.now() - started,
        bytes: input.totalBytes, modules: loaded.moduleCount}};
  };
}

/** Prepare and bind a candidate before the worker commits it as the current application. */
export function createRuntimeLaunchCandidate(params, { executable, onOutput, onUICommand }) {
  const debug = params.debug !== false;
  const options = {
    network: params.network ?? {}, compute: params.compute ?? {},
    environment: params.environment === undefined ? params.environmentVariables : params.environment,
    workingDirectory: params.workingDirectory ?? params.currentDirectory ?? '/',
    programArguments: params.programArguments === undefined ? (params.managedIL ? params.args : undefined) : params.programArguments,
    arguments: params.arguments,
    recordHistory: debug && params.recordHistory !== false,
    maxHistory: params.maxHistory, maxHistoryBytes: params.maxHistoryBytes,
    stepOverProperties: params.stepOverProperties === true,
    breakpointsEnabled: params.breakpointsEnabled !== false,
    maxInstructions: params.maxInstructions ?? 20_000_000,
    onOutput, onUICommand
  };
  let candidate;
  const module = executable(params);
  if (params.managedIL) {
    candidate = new CilDebugSession(module.inspector, {
      ...options, ...module.debugOptions, methodToken: params.methodToken, pdb: params.pdb, sources: params.sources
    });
    if (debug) candidate.setInstructionBreakpoints(params.instructionBreakpoints ?? []);
  } else candidate = new DebugSession(module.image, options);
  candidate.assemblyLoad = module.load;
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
