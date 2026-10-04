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
      if (['reset', 'opened', 'added'].includes(event.type)) this.apply();
    });
  }

  subscribe(listener, options) { return this.events.subscribe(listener, options); }
  isProjectLocked(id) { return (this.projectLocks.get(id)?.size ?? 0) > 0; }
  isDocumentLocked(uri) { return this.documents.projectsFor(uri).some(id => this.isProjectLocked(id)); }

  refresh() {
    const next = new Map();
    for (const session of this.sessions.list()) {
      if (!session.readOnly) continue;
      const set = next.get(session.projectId) ?? new Set();
      set.add(session.id);
      next.set(session.projectId, set);
    }
    this.projectLocks = next;
    this.apply();
    this.events.emit({ type: 'locks', projects: [...next.keys()] });
  }

  apply() {
    for (const [uri, views] of this.documents.views) {
      const readOnly = this.isDocumentLocked(uri);
      for (const view of views.values()) view.editor.setReadOnly?.(readOnly);
    }
  }

  dispose() {
    this.unsubscribe();
    this.unsubscribeDocuments();
    this.events.dispose();
  }
}
