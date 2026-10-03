import { sanitizeSessionUserSettings, sessionUserSettingsLimits } from '@sharpforge/project-system';
import { StartupConfiguration } from './startup-config.js';
import { LaunchProfiles } from './launch-profiles.js';
import { workbenchError } from './state-events.js';

function parse(value) {
  if (typeof value !== 'string') return value;
  if (value.length > sessionUserSettingsLimits.characters) throw new RangeError('Session recovery exceeds the limit');
  return JSON.parse(value);
}

function projectSignature(projects) {
  return JSON.stringify(projects.map(project => [
    project.id ?? project.path, String(project.outputType ?? project.outputKind ?? 'exe').toLowerCase()
  ]).sort(([left], [right]) => left.localeCompare(right)));
}

function freezeMetadata(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freezeMetadata(child);
  return Object.freeze(value);
}

function stageProfiles(metadata) {
  const profiles = new LaunchProfiles();
  for (const project of metadata.projects) {
    for (const profile of project.profiles) {
      profiles.set(project.projectId, {
        id: profile.id, name: profile.name, stopOnEntry: profile.stopOnEntry, renderer: profile.renderer,
        runtimeSettings: { compute: profile.compute }
      });
    }
    profiles.select(project.projectId, project.selected);
  }
  return profiles;
}

/** Stage portable session metadata against loaded projects before replacing either live owner. */
export class SessionRecovery {
  constructor({ builds, startup, profiles }) {
    Object.assign(this, { builds, startup, profiles });
    this.prepared = new WeakMap();
  }

  projects() { return this.builds.list().map(service => service.project); }

  export() {
    return sanitizeSessionUserSettings({ startupConfiguration: this.startup.snapshot(), launchProfiles: this.profiles.export() }, {
      projectIds: new Set(this.projects().map(project => project.id ?? project.path))
    });
  }

  /** Returns a reviewable metadata-only token. Invalid projects, libraries and profile references do not mutate live state. */
  prepare(payload, options = {}) {
    const projects = options.projects ?? this.projects();
    if (!Array.isArray(projects) || projects.length > sessionUserSettingsLimits.projects) throw new RangeError('Invalid recovery project count');
    const projectIds = new Set(projects.map(project => project.id ?? project.path));
    if (projectIds.size !== projects.length) throw new TypeError('Duplicate recovery project IDs');
    const metadata = sanitizeSessionUserSettings(parse(payload), { projectIds });
    const present = Object.keys(metadata).length > 0;
    const staged = {
      signature: projectSignature(projects), present,
      replaceProfiles: metadata.launchProfiles !== undefined, replaceStartup: metadata.startupConfiguration !== undefined
    };
    if (present) {
      const profileFallback = options.projects ? { version: 1, projects: [] } : this.profiles.export();
      const startupFallback = options.projects ? { version: 1, mode: 'single', entries: [] } : this.startup.snapshot();
      staged.profiles = stageProfiles(metadata.launchProfiles ?? profileFallback);
      staged.startup = new StartupConfiguration({ getProjects: () => projects });
      staged.startup.restore(metadata.startupConfiguration ?? startupFallback);
      for (const entry of staged.startup.entries) staged.profiles.get(entry.projectId, entry.profile);
    }
    const token = Object.freeze({ applies: present, metadata: freezeMetadata(structuredClone(metadata)) });
    this.prepared.set(token, staged);
    return token;
  }

  /** Commit once after the host has loaded and synchronized projects. Tokens are invalidated if project identity or kind changes. */
  apply(token) {
    const staged = this.prepared.get(token);
    if (!staged) throw workbenchError('SESSION_RECOVERY_TOKEN', 'Prepare session recovery before applying it');
    this.prepared.delete(token);
    if (staged.signature !== projectSignature(this.projects())) {
      throw workbenchError('SESSION_RECOVERY_STALE', 'The loaded projects changed while session settings were being restored');
    }
    if (!staged.present) return { restored: false };
    if (staged.replaceProfiles) this.profiles.replaceFrom(staged.profiles, { notify: false });
    if (staged.replaceStartup) this.startup.replaceFrom(staged.startup, { notify: false });
    staged.profiles.dispose();
    staged.startup.dispose();
    const failures = [];
    const owners = [staged.replaceProfiles && this.profiles, staged.replaceStartup && this.startup].filter(Boolean);
    for (const owner of owners) {
      try { owner.notifyRestored(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Session recovery committed, but a view could not refresh');
    return { restored: true, ...this.export() };
  }

  restore(payload) { return this.apply(this.prepare(payload)); }
}
