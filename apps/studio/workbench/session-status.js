export function sessionStatus(sessions) {
  const applications = sessions.list().filter(session => session.state !== 'created' && !session.disposed);
  const live = applications.filter(session => session.live);
  const paused = live.filter(session => session.state === 'paused');
  const running = live.filter(session => session.state !== 'paused');
  const state = paused.length ? 'break' : running.length ? 'running' : 'idle';
  const text = live.length > 1 ? `${live.length} applications · ${running.length} running · ${paused.length} paused` :
    paused.length ? `${paused[0].name} · Break` : running.length ? `${running[0].name} · Running` : 'Ready';
  return { id: 'debug-state', state, text, count: live.length, paused: paused.length, running: running.length, sessionId: sessions.activeId };
}

/** Text is replaced only when its meaning changes, avoiding repeated live-region announcements. */
export function mountSessionStatus(element, sessions, { title, setTitle } = {}) {
  let previous = null;
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  const render = () => {
    const status = sessionStatus(sessions);
    if (status.text !== previous) {
      element.textContent = status.text;
      previous = status.text;
      if (setTitle) setTitle(title ? `${title} — ${status.text}` : status.text);
    }
    element.dataset.debugState = status.state;
    element.classList.toggle('debugging', status.state === 'break');
    element.classList.toggle('running', status.state === 'running');
  };
  const unsubscribe = sessions.subscribe(render);
  render();
  return { render, dispose: unsubscribe };
}
