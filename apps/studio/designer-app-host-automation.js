/** App automation keeps identities explicit so tests and integrations cannot target the main debugger accidentally. */
export function contributeDesignerAppAutomation(automation, {host, sessions}) {
  const currentHost = () => typeof host === 'function' ? host() : host;
  const resolve = (sessionId, generation) => sessions.resolve(sessionId, generation, {active: false});
  const request = (sessionId, generation, method, parameters = {}) => {
    const app = resolve(sessionId, generation);
    return app.request(method, {...parameters, sessionId: app.runtimeSessionId, sessionGeneration: generation});
  };
  return automation.contributeAutomation('designerApps', {
    list: () => currentHost().list(),
    launch: options => currentHost().launch(options),
    stop: (sessionId, generation) => currentHost().stop(sessionId, {generation}),
    restart: (sessionId, generation) => currentHost().restart(sessionId, {generation}),
    pause: (sessionId, generation) => currentHost().pause(sessionId, {generation}),
    resume: (sessionId, generation) => currentHost().resume(sessionId, {generation}),
    snapshot: (sessionId, generation) => request(sessionId, generation, 'designSnapshot'),
    state: (sessionId, generation) => request(sessionId, generation, 'state'),
    select: (sessionId, generation, runtimeIds) => sessions.select(sessionId, generation, runtimeIds),
    selection: (sessionId, generation) => [...resolve(sessionId, generation).selection]
  });
}
