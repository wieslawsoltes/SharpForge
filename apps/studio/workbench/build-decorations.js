/** Badges are derived from current services and include an accessible verbal description. */
export function projectDecoration(projectId, { startup, sessions, builds }) {
  const configured = startup.entries?.some(entry => entry.projectId === projectId && entry.action !== 'none') ?? false;
  const applications = sessions.list({ projectId });
  const running = applications.filter(session => session.live && session.state !== 'paused' && session.state !== 'created').length;
  const paused = applications.filter(session => session.state === 'paused').length;
  const building = builds.get(projectId)?.busy === true;
  const badges = [configured && 'Startup project', building && 'Building', running && `${running} running`, paused && `${paused} paused`].filter(Boolean);
  return { projectId, startup: configured, building, running, paused, badges, accessibleName: [projectId, ...badges].join(', ') };
}

export function observeProjectDecorations(services, listener) {
  const update = () => {
    for (const build of services.builds.list()) listener(projectDecoration(build.id, services));
  };
  const subscriptions = [services.sessions.subscribe(update), services.builds.subscribe(update), services.startup.subscribe(update)];
  update();
  return () => subscriptions.forEach(unsubscribe => unsubscribe());
}
