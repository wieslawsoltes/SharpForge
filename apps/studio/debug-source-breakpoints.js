import {sourceBreakpointAt} from '@sharpforge/debugger';
import {debugSourceForWorkspace} from './debug-sources.js';

const mutableStates = new Set(['running', 'paused', 'waiting', 'terminated']);

/** Keep workspace anchors stable while binding their selected assembly-qualified execution document. */
export function createSourceBreakpointController(host) {
  const {state} = host;
  const requests = new Map();
  const executionUri = uri => debugSourceForWorkspace(state, uri)?.uri ?? uri;
  const bindings = uri => state.debug?.profile !== 'managed-il' && !state.buildDirty
    ? state.debug?.breakpoints?.filter(item => item.uri === executionUri(uri)) ?? [] : [];
  const refresh = () => {
    host.decorate();
    host.render('breakpoints');
  };

  async function sync(uri) {
    if (host.sync) return host.sync(uri);
    if (!state.debug || !mutableStates.has(state.debug.state)) return null;
    const sessionId = state.debug.sessionId;
    const target = executionUri(uri);
    const requestId = (requests.get(target) ?? 0) + 1;
    requests.set(target, requestId);
    const current = () => state.debug?.sessionId === sessionId && requests.get(target) === requestId;
    try {
      const bound = await host.request('breakpoints', {uri: target,
        breakpoints: (state.breakpoints[uri] ?? []).map(item => ({...item})), sessionId});
      if (!current() || !Array.isArray(bound)) return null;
      state.debug.breakpoints = [...(state.debug.breakpoints ?? []).filter(item => item.uri !== target), ...bound];
      refresh();
      return bound;
    } catch (error) {
      if (current()) host.onError(error);
      return null;
    }
  }

  function toggle(uri, line) {
    const breakpoints = state.breakpoints[uri] ??= [];
    const existing = sourceBreakpointAt(breakpoints, bindings(uri), line);
    const index = breakpoints.indexOf(existing);
    if (index >= 0) breakpoints.splice(index, 1);
    else breakpoints.push({line, enabled: true});
    breakpoints.sort((left, right) => left.line - right.line);
    const pending = sync(uri);
    refresh();
    host.save();
    return pending;
  }

  async function edit(uri, line) {
    const existing = sourceBreakpointAt(state.breakpoints[uri] ?? [], bindings(uri), line) ?? {line, enabled: true};
    const value = await host.editRule(existing, `Breakpoint · ${uri}:${existing.line}`, {source: true});
    if (!value) return null;
    const breakpoints = state.breakpoints[uri] ??= [];
    const index = breakpoints.indexOf(existing);
    if (index >= 0) breakpoints[index] = value;
    else breakpoints.push(value);
    await sync(uri);
    host.save();
    refresh();
    return value;
  }

  return {toggle, sync, edit};
}
