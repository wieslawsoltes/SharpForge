import {select} from '../ui.js';

export class ScopeSelector {
  constructor({sessions, projects = () => [], initial = 'solution', persist = () => {}} = {}) {
    this.sessions = sessions;
    this.projects = projects;
    this.value = initial;
    this.persist = persist;
  }
  options() {
    return [{value: 'solution', label: 'Entire solution'}, {value: 'current-project', label: 'Current project'},
      {value: 'current-document', label: 'Current document'}, {value: 'open-documents', label: 'Open documents'},
      ...this.projects().map(project => ({value: 'project:' + (project.id ?? project.path), label: 'Project: ' + project.name})),
      ...(this.sessions?.list() ?? []).map(session => ({value: 'session:' + session.id, label: 'Session: ' + session.name}))];
  }
  set(value) {
    if (!this.options().some(option => option.value === value)) throw new Error('Unknown scope ' + value);
    this.value = value;
    this.persist(value);
  }
  matches(row, context = {}) {
    if (this.value === 'solution') return true;
    if (this.value === 'current-project') return row.projectId === context.projectId || row.project === context.projectId;
    if (this.value === 'current-document') return row.uri === context.uri;
    if (this.value === 'open-documents') return context.openUris?.includes(row.uri) ?? false;
    if (this.value.startsWith('project:')) return (row.projectId ?? row.project) === this.value.slice(8);
    if (this.value.startsWith('session:')) return (row.sessionId ?? row.appId) === this.value.slice(8);
    return false;
  }
  mount(host, onChange) {
    const control = select(host.ownerDocument, 'Results scope', this.options(), this.value, value => {
      this.set(value);
      onChange();
    });
    host.append(control);
    return control;
  }
}
