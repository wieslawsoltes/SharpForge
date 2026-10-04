const debugPanels = new Set([
  'debug', 'stack', 'breakpoints', 'bytecode', 'disassembly', 'immediate', 'debug-session', 'watch', 'threads',
  'parallel-stacks', 'hot-reload', 'symbols', 'symbol-source', 'winui'
]);

/** Keep source navigation and panel activation in the same captured, synchronous reveal transaction. */
export function createStudioRuntimeReveals({ reveals, state, matchesSource, openSource, showSymbolSource, setPanel, renderPanel }) {
  return {
    paused(event) {
      return reveals.runtime(event, 'debug', () => {
        if (event.point && matchesSource(event.point.uri)) openSource(event.point);
        if (debugPanels.has(state.panel)) renderPanel();
        else setPanel('debug');
      });
    },
    completed(event) {
      return reveals.runtime(event, 'output', () => setPanel('output'));
    },
    symbols(event) {
      if (!event.point || matchesSource(event.point.uri) || !state.debugSources.has(event.point.uri)) return false;
      return reveals.runtime(event, 'symbol-source', () => showSymbolSource(event.point));
    }
  };
}
