import { WorkbenchEvents } from './state-events.js';

/** Shared files lock if any owning project is running; unrelated projects remain editable. */
export class DocumentLocks {
  constructor(documents, sessions) {
    this.documents = documents;
    this.sessions = sessions;
    this.events = new WorkbenchEvents();
    this.projectLocks = new Map();
    this.unsubscribe = sessions.subscribe(event => {
      if (['created', 'starting', 'state', 'ended', 'removed', 'editability'].includes(event.type)) this.refresh();
    });
    this.unsubscribeDocuments = documents.subscribe(event => {
      if (['opened', 'added', 'view'].includes(event.type)) this.apply([event.uri]);
      else if (event.type === 'membership') this.apply(event.uris);
      else if (event.type === 'reset') this.apply();
    });
    this.refresh();
    this.apply();
  }

  subscribe(listener, options) { return this.events.subscribe(listener, options); }
  isProjectLocked(id) { return (this.projectLocks.get(id)?.size ?? 0) > 0; }
  isDocumentExecutionLocked(uri) { return this.documents.projectsFor(uri).some(id => this.isProjectLocked(id)); }

  isDocumentLocked(uri) {
    const record = this.documents.get(uri);
    return record?.readOnly === true || record?.generated === true || this.readOnlyPolicy?.(uri, record) === true
      || this.isDocumentExecutionLocked(uri);
  }

  /** Add host policy without replacing project-session ownership or reading model.readOnly recursively. */
  setReadOnlyPolicy(policy) {
    if (policy !== undefined && typeof policy !== 'function') throw new TypeError('Document read-only policy must be a function');
    this.readOnlyPolicy = policy;
    this.apply();
  }

  refresh() {
    const next = new Map();
    for (const session of this.sessions.list()) {
      if (!session.readOnly) continue;
      const projects = new Set([session.projectId]);
      for (const dependency of session.lastLaunch?.dependencies ?? []) {
        if (typeof dependency.project === 'string') projects.add(dependency.project);
      }
      for (const project of projects) {
        const set = next.get(project) ?? new Set();
        set.add(session.id);
        next.set(project, set);
      }
    }
    const changed = next.size !== this.projectLocks.size || [...next].some(([projectId, ids]) => {
      const previous = this.projectLocks.get(projectId);
      return previous?.size !== ids.size || [...ids].some(id => !previous.has(id));
    });
    if (!changed) return;
    this.projectLocks = next;
    this.apply();
    this.events.emit({ type: 'locks', projects: [...next.keys()] });
  }

  apply(uris = null) {
    const models = this.documents.models?.keys() ?? [];
    const affected = uris ?? new Set([...models, ...this.documents.views.keys()]);
    for (const uri of affected) {
      const readOnly = this.isDocumentLocked(uri);
      const model = this.documents.models?.get(uri);
      if (model) model.readOnly = readOnly;
      for (const view of this.documents.views.get(uri)?.values() ?? []) view.editor.setReadOnly?.(readOnly);
    }
  }

  dispose() {
    this.unsubscribe();
    this.unsubscribeDocuments();
    this.events.dispose();
  }
}
