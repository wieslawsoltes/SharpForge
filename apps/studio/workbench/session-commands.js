/** All entry points execute the same session-scoped command catalog. */
export function registerSessionCommands(registry, { sessions, launches, projectId = () => null }) {
  const selected = context => sessions.get(context.sessionId ?? context.appId ?? sessions.activeId);
  const entries = [
    { id: 'debug.startNewInstance', label: 'Start New Instance', execute: context => launches.startNewInstance(context.projectId ?? projectId()) },
    { id: 'debug.stopAll', label: 'Stop All', enabled: () => sessions.list({ liveOnly: true }).length > 0, execute: () => sessions.stopAll() },
    { id: 'debug.stopSession', label: 'Stop', enabled: context => !!selected(context)?.live, execute: context => selected(context).stop() },
    { id: 'debug.restartSession', label: 'Restart', enabled: context => !!selected(context)?.lastLaunch, execute: context => selected(context).restart() },
    { id: 'debug.pauseSession', label: 'Break', enabled: context => !!selected(context)?.live, execute: context => selected(context).request('pause') },
    {
      id: 'debug.continueSession', label: 'Continue', enabled: context => selected(context)?.state === 'paused',
      execute: context => selected(context).request('resume', { mode: 'continue' })
    },
    { id: 'debug.detachSession', label: 'Detach', enabled: context => selected(context)?.debugging === true, execute: context => selected(context).detach() }
  ];
  const disposers = entries.map(entry => registry.register(entry));
  return () => disposers.reverse().forEach(dispose => dispose());
}
