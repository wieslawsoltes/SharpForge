import { WorkbenchEvents, requireIdentifier, workbenchError } from './state-events.js';
import { startupActions, startupModes } from '@sharpforge/project-system';
export { startupActions, startupModes } from '@sharpforge/project-system';

function normalizeAction(action) {
  const aliases = { None: 'none', Start: 'start', 'Start without debugging': 'startWithoutDebugging' };
  const value = aliases[action] ?? action;
  if (!startupActions.includes(value)) throw new TypeError(`Unknown startup action '${action}'`);
  return value;
}

/** Serializable solution configuration; launch permissions are intentionally stored elsewhere. */
export class StartupConfiguration {
  constructor({ getProjects = () => [], value = null, save } = {}) {
    this.getProjects = getProjects;
    this.save = save;
    this.mode = 'single';
    this.entries = [];
    this.events = new WorkbenchEvents();
    if (value) this.restore(value);
  }

  subscribe(listener, options) { return this.events.subscribe(listener, options); }

  projects() {
    const projects = this.getProjects();
    const values = projects instanceof Map ? [...projects.values()] : projects;
    return new Map(values.map(project => [project.id ?? project.path, project]));
  }

  validateProject(id, action = 'start') {
    requireIdentifier(id, 'Startup project');
    const project = this.projects().get(id);
    if (!project) throw workbenchError('STARTUP_PROJECT_MISSING', `Unknown startup project '${id}'`);
    if (action !== 'none' && String(project.outputType ?? project.outputKind ?? 'exe').toLowerCase() === 'library') {
      throw workbenchError('STARTUP_LIBRARY', `Library project '${id}' cannot be started as an application`);
    }
    return project;
  }

  configure({ mode = this.mode, entries = this.entries } = {}) {
    if (!startupModes.includes(mode)) throw new TypeError('Invalid startup mode');
    if (!Array.isArray(entries) || entries.length > 1024) throw new RangeError('Invalid startup project count');
    const seen = new Set();
    const next = entries.map((entry, index) => {
      const projectId = entry.projectId ?? entry.id ?? entry.path;
      const action = normalizeAction(entry.action ?? 'start');
      this.validateProject(projectId, action);
      if (seen.has(projectId)) throw new TypeError(`Duplicate startup project '${projectId}'`);
      seen.add(projectId);
      const order = entry.order ?? index;
      if (!Number.isSafeInteger(order) || order < 0) throw new RangeError('Invalid startup order');
      return { projectId, action, order, profile: entry.profile ?? 'default' };
    });
    next.sort((left, right) => left.order - right.order || left.projectId.localeCompare(right.projectId));
    const ordered = next.map((entry, order) => ({ ...entry, order }));
    const value = { version: 1, mode, entries: ordered.map(entry => ({ ...entry })) };
    this.save?.(structuredClone(value));
    this.mode = mode;
    this.entries = ordered;
    this.events.emit({ type: 'startup', value });
    return value;
  }

  select(projectId, { profile = 'default', debug = true } = {}) {
    return this.configure({
      mode: 'single',
      entries: [{ projectId, profile, action: debug ? 'start' : 'startWithoutDebugging', order: 0 }]
    });
  }

  resolve({ currentProjectId, currentProfileId = 'default', debug = true } = {}) {
    let entries = this.entries;
    if (this.mode === 'currentSelection') {
      this.validateProject(currentProjectId);
      entries = [{ projectId: currentProjectId, action: 'start', order: 0, profile: currentProfileId }];
    }
    const enabled = entries.filter(entry => entry.action !== 'none');
    const selected = this.mode === 'single' ? enabled.slice(0, 1) : enabled;
    return selected.map(entry => {
      this.validateProject(entry.projectId, entry.action);
      return { ...entry, debug: debug && entry.action === 'start' };
    });
  }

  snapshot() { return { version: 1, mode: this.mode, entries: this.entries.map(entry => ({ ...entry })) }; }
  serialize() { return JSON.stringify(this.snapshot()); }

  restore(value) {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || parsed.version !== 1) throw new TypeError('Unsupported startup configuration version');
    return this.configure(parsed);
  }

  /** Commit an already validated staging model without invoking a persistence callback during import. */
  replaceFrom(staged, { notify = true } = {}) {
    if (!(staged instanceof StartupConfiguration)) throw new TypeError('Expected a staged startup configuration');
    const value = staged.snapshot();
    this.mode = value.mode;
    this.entries = value.entries;
    if (notify) this.notifyRestored();
  }

  notifyRestored() { this.events.emit({ type: 'startup', value: this.snapshot(), restored: true }); }

  dispose() { this.events.dispose(); }
}
