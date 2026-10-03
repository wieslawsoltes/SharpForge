/**
 * Requests use {id, method, params}; replies use {id, result} or {id, error} with structured diagnostics.
 * Compiler replies also carry revision. Events have no id. Compiler cancelRequest notifications target params.requestId.
 */
export const workerMethods=Object.freeze({
  "compiler": [
    "analyze",
    "build",
    "inspectAssembly",
    "methodIL",
    "decompileMethod",
    "allIL",
    "editableIL",
    "assembleIL",
    "verifyIL",
    "findInFiles",
    "replaceAll",
    "callHierarchy",
    "incomingCalls",
    "outgoingCalls",
    "referenceLenses",
    "selectionRanges",
    "codeActions",
    "format",
    "validateRefactoring",
    "validateDesigner",
    "designAnalyze",
    "designResourceAnalyze",
    "cancelRequest",
    "configureExtensions",
    "importAssembly",
    "completion",
    "hover",
    "definition",
    "references",
    "rename",
    "symbols"
  ],
  "runtime": [
    "launch",
    "resume",
    "pause",
    "stop",
    "stepBack",
    "reverseContinue",
    "dataBreakpointInfo",
    "dataBreakpoints",
    "breakpoints",
    "functionBreakpoints",
    "breakpointLocations",
    "breakpointsEnabled",
    "exceptionBreak",
    "instructionBreakpoints",
    "runToInstruction",
    "disassemblyMethods",
    "runToCursor",
    "disassemble",
    "gotoTargets",
    "setNextStatement",
    "hotReload",
    "evaluateFunction",
    "loadSymbols",
    "symbolInfo",
    "threads",
    "parallelStacks",
    "stackTrace",
    "freezeThread",
    "uiEvent",
    "uiAnimationAdvance",
    "uiAnimationMode",
    "runtimeInfo",
    "uiScene",
    "designSnapshot",
    "applyDesign",
    "uiLayout",
    "evaluate",
    "setVariable",
    "locals",
    "children",
    "collect",
    "heapPage",
    "heapCensus",
    "retentionPath",
    "heap",
    "state"
  ]
});
for (const methods of Object.values(workerMethods)) Object.freeze(methods);

/** Register explicit handlers; dispatch forwards worker-local context without cloning it into source parameters. */
export function createWorkerProtocol(worker) {
  if (!Object.hasOwn(workerMethods, worker)) throw new TypeError('Unknown worker ' + worker);
  const methods = new Set(workerMethods[worker]);
  const handlers = new Map();
  function assertMethod(method) {
    if (methods.has(method) && handlers.has(method)) return;
    const error = new Error(`Unknown ${worker} request '${method}'`);
    error.name = 'ProtocolError';
    error.code = 'UNKNOWN_METHOD';
    throw error;
  }
  return {
    registerHandler(method, handler) {
      if (!methods.has(method) || typeof handler !== 'function') throw new TypeError('Invalid worker handler ' + method);
      if (handlers.has(method)) throw new Error('Duplicate worker handler ' + method);
      handlers.set(method, handler);
      return () => handlers.delete(method);
    },
    assertMethod,
    dispatch(method, params = {}, context = {}) {
      assertMethod(method);
      if (!params || typeof params !== 'object' || Array.isArray(params)) throw new TypeError('Worker params must be an object');
      return handlers.get(method)(params, method, context);
    },
    dispose() { handlers.clear(); }
  };
}

/** Validate a structured request before dispatch. The owning transport validates correlation ids. */
export function readWorkerRequest(data) {
  const fail = message => {
    const error = new TypeError(message);
    error.code = 'BAD_REQUEST';
    throw error;
  };
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Worker request must be an object');
  if (typeof data.method !== 'string' || !data.method) fail('Worker method must be a nonempty string');
  const params = data.params ?? {};
  if (!params || typeof params !== 'object' || Array.isArray(params)) fail('Worker params must be an object');
  return {id: data.id, method: data.method, params};
}
