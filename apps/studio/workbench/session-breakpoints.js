import { WorkbenchEvents, requireIdentifier } from './state-events.js';

/** User breakpoints are project-scoped; worker binding results are tracked per application. */
export class SessionBreakpoints {
  constructor(sessions) {
    this.sessions = sessions;
    this.projects = new Map();
    this.bindings = new Map();
    this.events = new WorkbenchEvents();
    this.unsubscribe = sessions.subscribe(event => {
      if (event.type === 'state') {
        this.bindings.set(event.appId, event.session.boundBreakpoints);
        this.events.emit({ type: 'bound', sessionId: event.appId, projectId: event.projectId, bindings: event.session.boundBreakpoints });
      }
      if (event.type === 'removed') this.bindings.delete(event.appId);
    });
  }

  subscribe(listener, options) { return this.events.subscribe(listener, options); }

  forProject(projectId) {
    const files = this.projects.get(projectId) ?? new Map();
    return Object.fromEntries([...files].map(([uri, breakpoints]) => [uri, breakpoints.map(value => ({ ...value }))]));
  }

  async set(projectId, uri, breakpoints) {
    requireIdentifier(projectId, 'Project id');
    requireIdentifier(uri, 'Document URI');
    if (!Array.isArray(breakpoints) || breakpoints.length > 10_000) throw new RangeError('Invalid breakpoint list');
    const values = breakpoints.map(breakpoint => {
      if (!Number.isInteger(breakpoint.line) || breakpoint.line < 1) throw new RangeError('Breakpoint lines are one-based');
      return { ...breakpoint };
    });
    const files = this.projects.get(projectId) ?? new Map();
    files.set(uri, values);
    this.projects.set(projectId, files);
    const targets = this.sessions.list({ projectId }).filter(session => session.runtimeSession !== null && !session.disposed);
    const results = await Promise.allSettled(targets.map(session => session.request('breakpoints', { uri, breakpoints: values })));
    const failures = results.flatMap((result, index) => result.status === 'rejected' ? [{ sessionId: targets[index].id, error: result.reason }] : []);
    this.events.emit({ type: 'changed', projectId, uri, breakpoints: values, failures });
    return { updated: targets.length - failures.length, failures };
  }

  binding(sessionId, breakpointId) { return this.bindings.get(sessionId)?.get(breakpointId) ?? null; }

  removeProject(projectId) {
    this.projects.delete(projectId);
    this.events.emit({ type: 'removed', projectId });
  }

  dispose() { this.unsubscribe(); this.events.dispose(); }
}
