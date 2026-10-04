import { WorkbenchEvents, requireIdentifier } from './state-events.js';

const ownsProject = (session, projectId) => session.projectId === projectId
  || session.lastLaunch?.dependencies?.some(dependency => dependency.project === projectId);

function executionUris(session, projectId, uri, sourceText) {
  const records = [...(session.debugSourceRecords?.values() ?? [])].filter(record =>
    (record.originalUri ?? record.uri) === uri || record.uri === uri);
  if (!records.length) return [uri];
  const matches = records.filter(record => (sourceText === undefined || record.text === sourceText)
    && (record.project === undefined || record.project === projectId
      || record.origins?.some(origin => origin.project === projectId)));
  return [...new Set(matches.map(record => record.uri))];
}

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

  forProject(projectId, dependencies = []) {
    const files = new Map();
    for (const id of new Set([projectId, ...dependencies])) {
      for (const [uri, breakpoints] of this.projects.get(id) ?? []) {
        const merged = new Map((files.get(uri) ?? []).map(value => [JSON.stringify(value), value]));
        for (const value of breakpoints) merged.set(JSON.stringify(value), { ...value });
        files.set(uri, [...merged.values()]);
      }
    }
    return Object.fromEntries(files);
  }

  async set(projectId, uri, breakpoints, { sourceText } = {}) {
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
    const targets = this.sessions.list().filter(session => ownsProject(session, projectId)
      && session.runtimeSession !== null && !session.disposed);
    const results = await Promise.allSettled(targets.map(async session => {
      const uris = executionUris(session, projectId, uri, sourceText);
      if (!uris.length) throw new Error('The workspace document no longer matches the source in this application: ' + uri);
      return Promise.all(uris.map(executionUri => session.request('breakpoints', { uri: executionUri, breakpoints: values })));
    }));
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
