/**
 * Request envelopes: {id, method, params}; replies: {id, result} or {id,error:{name,message,code}}.
 * Compiler replies also carry revision. Runtime events use event/sessionId and no request id.
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
    "resolveCodeAction",
    "outlineReorder",
    "validateWorkspaceEdit",
    "format",
    "validateRefactoring",
    "validateDesigner",
    "configureExtensions",
    "importAssembly",
    "completion",
    "hover",
    "definition",
    "references",
    "rename",
    "prepareTypeRename",
    "symbols",
    "signatureHelp",
    "diagnostics",
    "semanticTokens",
    "foldingRanges",
    "inlayHints",
    "prepareRename",
    "documentHighlights",
    "formatRange",
    "formatOnType",
    "readDocument"
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
    "executionMetrics",
    "retentionPath",
    "heap",
    "state"
  ]
});
for (const methods of Object.values(workerMethods)) Object.freeze(methods);
export function createWorkerProtocol(worker) {
  const methods = workerMethods[worker];
  if (!methods) throw new TypeError('Unknown worker ' + worker);
  const handlers = new Map();
  function assertMethod(method) {
    if (!methods.includes(method) || !handlers.has(method)) {
      const error = new Error(`Unknown ${worker} request '${method}'`);
      error.name = 'ProtocolError';
      error.code = 'UNKNOWN_METHOD';
      throw error;
    }
  }
  return {
    registerHandler(method, handler) {
      if (!methods.includes(method) || typeof handler !== 'function') throw new TypeError('Invalid worker handler ' + method);
      if (handlers.has(method)) throw new Error('Duplicate worker handler ' + method);
      handlers.set(method, handler);
      return () => handlers.delete(method);
    },
    assertMethod,
    dispatch(method, params = {}) {
      assertMethod(method);
      if (!params || typeof params !== 'object' || Array.isArray(params)) throw new TypeError('Worker params must be an object');
      return handlers.get(method)(params, method);
    },
    dispose() { handlers.clear(); }
  };
}
export function readWorkerRequest(data) {
  const fail = message => {
    const error = new TypeError(message);
    error.code = 'BAD_REQUEST';
    throw error;
  };
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Worker request must be an object');
  if (typeof data.method !== 'string' || !data.method) fail('Worker method must be a nonempty string');
  const params = data.params ?? {};
  if (typeof params !== 'object' || Array.isArray(params)) fail('Worker params must be an object');
  return {id: data.id, method: data.method, params};
}
