const capabilities = Object.freeze({
  supportsGotoTargetsRequest: true,
  supportsBreakpointLocationsRequest: true,
  supportsLoadedSourcesRequest: true,
  supportsConfigurationDoneRequest: true,
  supportsConditionalBreakpoints: true,
  supportsHitConditionalBreakpoints: true,
  supportsLogPoints: true,
  supportsFunctionBreakpoints: true,
  supportsSetVariable: true,
  supportsRestartRequest: true,
  supportsDisassembleRequest: true,
  supportsInstructionBreakpoints: true,
  supportsStepBack: true,
  supportsDataBreakpoints: true,
  supportsEvaluateForHovers: true,
  supportsReadMemoryRequest: true,
  supportsWriteMemoryRequest: true
});

/** Negotiate client positions and optional memory metadata without changing existing request capabilities. */
export function initializeDebugCapabilities(adapter, arguments_) {
  adapter.lineBase = arguments_.linesStartAt1 === false ? 0 : 1;
  adapter.columnBase = arguments_.columnsStartAt1 === false ? 0 : 1;
  adapter.supportsMemoryReferences = arguments_.supportsMemoryReferences === true;
  adapter.supportsMemoryEvents = arguments_.supportsMemoryEvent === true;
  return {...capabilities, exceptionBreakpointFilters: [
    {filter: 'all', label: 'All managed exceptions', default: false},
    {filter: 'uncaught', label: 'Uncaught managed exceptions', default: true}
  ]};
}
