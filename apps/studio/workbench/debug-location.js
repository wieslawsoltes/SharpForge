import { workbenchError } from './state-events.js';
import { selectField, replaceOptions } from './session-dom.js';

/** Thread/frame inspection is versioned to the captured application, independently of execution. */
export class DebugLocation {
  constructor(sessions, { onNavigate, onChanged } = {}) {
    this.sessions = sessions;
    this.onNavigate = onNavigate;
    this.onChanged = onChanged;
    this.epochs = new Map();
  }

  selectProcess(id) { return this.sessions.setActive(id); }

  async selectThread(threadId, sessionId = this.sessions.activeId) {
    const session = this.sessions.require(sessionId);
    if (!session.debug?.threads?.some(thread => thread.id === threadId)) throw workbenchError('THREAD_MISSING', 'Thread is unavailable');
    const identity = session.identity;
    const epoch = (this.epochs.get(sessionId) ?? 0) + 1;
    this.epochs.set(sessionId, epoch);
    const frames = await session.request('stackTrace', { threadId, identity });
    if (session.identity !== identity || this.epochs.get(sessionId) !== epoch) return null;
    session.inspectedThreadId = threadId;
    session.inspectedThreadFrames = frames;
    session.frameId = frames[0]?.id ?? null;
    if (frames.length) await this.selectFrame(frames[0].id, sessionId);
    session.emit('location', { threadId, frames });
    this.onChanged?.(session);
    return frames;
  }

  async selectFrame(frameId, sessionId = this.sessions.activeId) {
    const session = this.sessions.require(sessionId);
    const frame = (session.inspectedThreadFrames ?? session.debug?.frames ?? []).find(item => item.id === frameId);
    if (!frame) throw workbenchError('FRAME_MISSING', 'Stack frame is unavailable');
    const identity = session.identity;
    session.frameId = frameId;
    const locals = await session.request('locals', { frameId, identity });
    if (session.identity !== identity || session.frameId !== frameId) return null;
    session.inspectedLocals = locals;
    session.watchEpoch++;
    session.emit('location', { frameId, frame, locals });
    if (this.sessions.activeId === sessionId) this.onNavigate?.(frame, session);
    this.onChanged?.(session);
    return locals;
  }
}

export function mountDebugLocation(root, { sessions, location = new DebugLocation(sessions), onError = error => { throw error; } }) {
  const document = root.ownerDocument;
  const process = selectField(document, 'Process');
  const thread = selectField(document, 'Thread');
  const frame = selectField(document, 'Stack Frame');
  root.append(process.wrapper, thread.wrapper, frame.wrapper);
  const controller = new AbortController();
  const render = () => {
    const current = sessions.active;
    replaceOptions(process.select, sessions.list().map(session => ({ value: session.id, label: `${session.name} (${session.id})` })), current?.id);
    const threads = current?.debug?.threads ?? [];
    replaceOptions(thread.select, threads.map(value => ({ value: value.id, label: `${value.id}: ${value.name ?? value.status}` })),
      current?.inspectedThreadId ?? current?.debug?.threadId);
    const frames = current?.inspectedThreadFrames ?? current?.debug?.frames ?? [];
    replaceOptions(frame.select, frames.map(value => ({ value: value.id, label: value.name ?? String(value.id) })), current?.frameId);
    thread.select.disabled = !threads.length;
    frame.select.disabled = !frames.length;
  };
  process.select.addEventListener('change', () => location.selectProcess(process.select.value), { signal: controller.signal });
  thread.select.addEventListener('change', () => location.selectThread(Number(thread.select.value)).catch(onError), { signal: controller.signal });
  frame.select.addEventListener('change', () => location.selectFrame(Number(frame.select.value)).catch(onError), { signal: controller.signal });
  const unsubscribe = sessions.subscribe(render);
  render();
  return {
    render,
    dispose() {
      controller.abort();
      unsubscribe();
      for (const value of [process, thread, frame]) value.wrapper.remove();
    }
  };
}
