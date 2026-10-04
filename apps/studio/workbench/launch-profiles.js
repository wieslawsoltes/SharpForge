import { WorkbenchEvents, requireIdentifier } from './state-events.js';
import { validateSessionSettings, sessionLaunchSettings } from './session-settings.js';
import { validateProgramArguments, validateLaunchEnvironment } from '@sharpforge/runtime';

/** Profiles are project-scoped. Export strips environment values and all runtime grants. */
export class LaunchProfiles {
  constructor() {
    this.projects = new Map();
    this.selected = new Map();
    this.events = new WorkbenchEvents();
  }

  subscribe(listener, options) { return this.events.subscribe(listener, options); }

  validate(profile) {
    const id = requireIdentifier(profile.id ?? 'default', 'Launch profile id');
    if (id.length > 512) throw new RangeError('Launch profile ID limit reached');
    const name = requireIdentifier(profile.name ?? id, 'Launch profile name');
    if (name.length > 200) throw new RangeError('Launch profile name limit reached');
    const args = validateProgramArguments(profile.arguments);
    const environment = validateLaunchEnvironment(profile.environment);
    const renderer = profile.renderer ?? 'auto';
    if (!['auto', 'webgpu', 'canvas2d', 'dom'].includes(renderer)) throw new TypeError('Unknown application renderer');
    return {
      id, name, arguments: [...args], environment: { ...environment },
      stopOnEntry: profile.stopOnEntry === true, renderer, runtimeSettings: validateSessionSettings(profile.runtimeSettings)
    };
  }

  set(projectId, profile) {
    requireIdentifier(projectId, 'Project id');
    const value = this.validate(profile);
    const profiles = this.projects.get(projectId) ?? new Map();
    if (profiles.size >= 64 && !profiles.has(value.id)) throw new RangeError('Project launch profile limit reached');
    profiles.set(value.id, value);
    this.projects.set(projectId, profiles);
    if (!this.selected.has(projectId)) this.selected.set(projectId, value.id);
    this.events.emit({ type: 'profile', projectId, profile: structuredClone(value) });
    return structuredClone(value);
  }

  get(projectId, id = this.selected.get(projectId) ?? 'default') {
    const profile = this.projects.get(projectId)?.get(id);
    if (profile) return structuredClone(profile);
    if (id !== 'default') throw new Error(`Unknown launch profile '${id}' for '${projectId}'`);
    return this.validate({ id: 'default', name: 'Default' });
  }

  list(projectId) {
    const values = this.projects.get(projectId);
    return values ? [...values.values()].map(value => structuredClone(value)) : [this.get(projectId)];
  }

  select(projectId, id) {
    this.get(projectId, id);
    this.selected.set(projectId, id);
    this.events.emit({ type: 'selected', projectId, profileId: id });
  }

  launchOptions(projectId, id) {
    const profile = this.get(projectId, id);
    return {
      ...sessionLaunchSettings(profile.runtimeSettings), programArguments: [...profile.arguments],
      environment: { ...profile.environment }, stopOnEntry: profile.stopOnEntry
    };
  }

  export() {
    const projects = [...this.projects].sort(([left], [right]) => left.localeCompare(right)).map(([projectId, profiles]) => ({
      projectId,
      selected: this.selected.get(projectId),
      profiles: [...profiles.values()].map(profile => ({
        id: profile.id, name: profile.name, stopOnEntry: profile.stopOnEntry, renderer: profile.renderer,
        compute: { ...profile.runtimeSettings.compute }
      }))
    }));
    return { version: 1, projects };
  }

  /** Commit a validated staging model; recovery may notify after all related owners are consistent. */
  replaceFrom(staged, { notify = true } = {}) {
    if (!(staged instanceof LaunchProfiles)) throw new TypeError('Expected staged launch profiles');
    const projects = structuredClone(staged.projects);
    const selected = new Map(staged.selected);
    this.projects = projects;
    this.selected = selected;
    if (notify) this.notifyRestored();
  }

  notifyRestored() { this.events.emit({ type: 'profiles-restored' }); }

  dispose() { this.projects.clear(); this.selected.clear(); this.events.dispose(); }
}
