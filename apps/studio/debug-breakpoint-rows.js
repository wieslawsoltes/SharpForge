import {debugSourceForWorkspace} from './debug-sources.js';

/** Keep persisted workspace anchors while displaying bindings for their current executable document. */
export function debugBreakpointRows(state) {
  const debug = state.debug;
  const source = Object.entries(state.breakpoints).flatMap(([uri, items]) => {
    const executionUri = debugSourceForWorkspace(state, uri)?.uri ?? uri;
    return items.map((item, index) => ({kind: 'source', uri, index, item,
      binding: debug?.profile !== 'managed-il' && !state.buildDirty ? debug?.breakpoints?.find(binding =>
        binding.uri === executionUri && binding.requestedLine === item.line
        && (binding.requestedColumn ?? 1) === (item.column ?? 1)) : null}));
  });
  const functions = state.functionBreakpoints.map((item, index) =>
    ({kind: 'function', index, item, binding: debug?.functionBreakpoints?.[index]}));
  const data = (debug?.dataBreakpoints ?? []).map((item, index) => ({kind: 'data', index, item, binding: item}));
  const instructions = debug?.profile === 'managed-il' ? (debug.breakpoints ?? [])
    .map((item, index) => ({kind: 'instruction', index, item, binding: item})).filter(row => !row.item.source) : [];
  return [...source, ...functions, ...data, ...instructions];
}
