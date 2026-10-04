/** Bind views explicitly: only active-session events update shared debugger tools. */
export function routeSessionEvents(sessions, {
  onActiveState,
  onActiveOutput,
  onApplicationUI,
  onSessionEvent,
  onError
} = {}) {
  return sessions.subscribe(event => {
    onSessionEvent?.(event);
    if (event.type === 'ui') onApplicationUI?.(event.session, event.commands, event);
    if (event.type === 'error') onError?.(event.error, event.session);
    if (event.type === 'selected') onActiveState?.(event.session?.debug ?? null, event.session, event);
    if (!event.active) return;
    if (event.type === 'state' || event.type === 'location') onActiveState?.(event.session.debug, event.session, event);
    if (event.type === 'output') onActiveOutput?.(event.session.programOutput, event.session, event);
  });
}
