import { defaultSessionSettings, validateSessionSettings, sessionLaunchSettings } from './session-settings.js';
import { legacyDebug } from './session-compat.js';
import { workbenchError } from './state-events.js';

function languageVersion(value) {
  if (typeof value !== 'string' || !/^(?:[1-9]|1[0-4]|preview)$/.test(value)) {
    throw workbenchError('RUNTIME_LANGUAGE_VERSION', 'Choose a supported language version or preview');
  }
  return value;
}

function targetId(target) {
  return target.sessionId ? `session:${target.sessionId}` : `profile:${JSON.stringify([target.projectId, target.profileId])}`;
}

/** Bridge the settings tool to an explicit profile or application; changing the active debugger never changes its grants. */
export class RuntimeToolsBridge {
  constructor({ services, state, getProjectId = () => services.builds.activeId, getProfileId, save = () => {}, onChanged }) {
    Object.assign(this, { services, sourceState: state, getProjectId, getProfileId, save, onChanged });
    this.selection = null;
    this.pendingBuilds = new Set();
    const descriptors = {
      runtimeSettings: { get: () => this.runtimeSettings(), set: value => this.configure(value) },
      langVersion: { get: () => this.language(), set: value => this.configure({ langVersion: value }) },
      projectSystem: { get: () => this.context().projectId !== '$workspace' },
      readOnly: { get: () => this.services.sessions.list({ projectId: this.context().projectId }).some(session => session.readOnly) },
      debug: { get: () => legacyDebug(this.sessionFor(this.context())) }
    };
    this.state = Object.defineProperties({}, Object.fromEntries(Object.entries(descriptors).map(([key, value]) => [
      key, { ...value, enumerable: true }
    ])));
  }

  resolve(target) {
    if (target?.sessionId) {
      const session = this.services.sessions.require(target.sessionId);
      return { kind: 'session', sessionId: session.id, projectId: session.projectId, profileId: session.profileId };
    }
    const projectId = target?.projectId ?? this.getProjectId();
    if (!this.services.builds.get(projectId)) throw workbenchError('RUNTIME_SETTINGS_PROJECT', 'Choose a loaded project for runtime settings');
    const profileId = target?.profileId ?? this.getProfileId?.(projectId) ?? this.services.profiles.selected.get(projectId) ?? 'default';
    this.services.profiles.get(projectId, profileId);
    return { kind: 'profile', projectId, profileId };
  }

  context() {
    if (this.selection && (this.selection.sessionId ? !this.services.sessions.get(this.selection.sessionId)
      : !this.services.builds.get(this.selection.projectId))) {
      return { ...this.selection, id: targetId(this.selection), unavailable: true };
    }
    const value = this.resolve(this.selection);
    return { ...value, id: targetId(value) };
  }

  /** Select a stable target without changing the active project, startup selection or debugger application. */
  select(target = null) {
    if (typeof target === 'string') {
      if (target.startsWith('session:')) target = { sessionId: target.slice('session:'.length) };
      else if (target.startsWith('profile:')) {
        const values = JSON.parse(target.slice('profile:'.length));
        if (!Array.isArray(values) || values.length !== 2) throw new TypeError('Invalid runtime settings target');
        target = { projectId: values[0], profileId: values[1] };
      } else throw new TypeError('Unknown runtime settings target');
    }
    const resolved = this.resolve(target);
    this.selection = target === null ? null : resolved;
    this.onChanged?.({ type: 'target', target: this.context() });
    return this.context();
  }

  targets() {
    const context = this.context();
    const projectId = this.services.builds.get(context.projectId) ? context.projectId : this.getProjectId();
    const project = this.services.builds.get(projectId)?.project;
    const profiles = (project ? this.services.profiles.list(projectId) : []).map(profile => ({
      id: targetId({ projectId, profileId: profile.id }),
      label: `${project.name ?? projectId} · ${profile.name} · next launch`, kind: 'profile'
    }));
    if (context.unavailable) profiles.push({ id: context.id, label: 'Previous settings target is unavailable — choose a target', kind: 'unavailable' });
    else if (!profiles.some(target => target.id === targetId({ projectId: context.projectId, profileId: context.profileId }))) {
      profiles.push({
        id: targetId({ projectId: context.projectId, profileId: context.profileId }),
        label: `${project?.name ?? context.projectId} · ${context.profileId} · next launch`, kind: 'profile'
      });
    }
    const sessions = this.services.sessions.list().map(session => ({
      id: targetId({ sessionId: session.id }), kind: 'session',
      label: `${session.name} · ${session.id} · ${session.profileId} · ${session.state}`
    }));
    return [...profiles, ...sessions];
  }

  runtimeSettings(context = this.context()) {
    if (context.unavailable) throw workbenchError('RUNTIME_SETTINGS_TARGET', 'This settings target is unavailable; choose another target');
    return context.sessionId ? this.services.settings.get(context.sessionId)
      : this.services.profiles.get(context.projectId, context.profileId).runtimeSettings;
  }

  language(context = this.context()) {
    const state = this.sourceState();
    if (context.projectId === '$workspace') return state.langVersion ?? '14';
    const project = state.projectSystem?.projects?.get(context.projectId);
    if (project) return state.projectSystem.compilationOptions(context.projectId).langVersion ?? '14';
    return this.services.builds.get(context.projectId)?.project.compilationOptions?.langVersion ?? '14';
  }

  settings() {
    const context = this.context();
    return context.unavailable ? { ...defaultSessionSettings(), langVersion: this.language(context), unavailable: true }
      : { ...this.runtimeSettings(context), langVersion: this.language(context) };
  }

  configure(patch = {}) {
    const context = this.context();
    const previous = this.runtimeSettings(context);
    const { langVersion, ...runtimePatch } = patch;
    const language = languageVersion(langVersion ?? this.language(context));
    const changedLanguage = language !== this.language(context);
    if (changedLanguage && context.projectId !== '$workspace') {
      throw workbenchError('RUNTIME_PROJECT_LANGUAGE', 'Change this project language version in its csproj file');
    }
    if (changedLanguage && this.state.readOnly) throw workbenchError('RUNTIME_LANGUAGE_LOCKED', 'Stop this project before changing its language version');
    const next = validateSessionSettings({ ...previous, ...runtimePatch, compute: { ...previous.compute, ...runtimePatch.compute } });
    if (context.sessionId) this.services.settings.configure(context.sessionId, next);
    else {
      const profile = this.services.profiles.get(context.projectId, context.profileId);
      this.services.profiles.set(context.projectId, { ...profile, runtimeSettings: next });
    }
    if (changedLanguage) {
      const state = this.sourceState();
      state.langVersion = language;
      state.revision = (state.revision ?? 0) + 1;
      this.services.builds.get(context.projectId).invalidate('language');
      this.pendingBuilds.add(context.projectId);
    }
    this.save();
    this.onChanged?.({ type: 'settings', target: context, appliesOnNextLaunch: true });
    return this.settings();
  }

  /** Only execution capabilities are returned; raw managed method invocations keep their own argument vector. */
  launchOptions(target, profileId) {
    const context = target === undefined ? this.context()
      : this.resolve(typeof target === 'string' ? { projectId: target, profileId } : target);
    return sessionLaunchSettings(this.runtimeSettings(context));
  }

  sessionFor(context) {
    if (context.unavailable) return null;
    if (context.sessionId) return this.services.sessions.require(context.sessionId);
    const matches = this.services.sessions.list({ projectId: context.projectId }).filter(session => session.profileId === context.profileId);
    return matches.find(session => session.id === this.services.sessions.activeId) ?? matches.at(-1) ?? null;
  }

  request(method, params, options) {
    const session = this.sessionFor(this.context());
    if (!session) return Promise.reject(workbenchError('RUNTIME_SETTINGS_SESSION', 'No application is associated with this settings target'));
    return session.request(method, params, options);
  }

  async build() {
    const { projectId } = this.context();
    if (!this.pendingBuilds.delete(projectId)) return { skipped: true, reason: 'execution-settings-only' };
    try { return await this.services.builds.get(projectId).build(); }
    catch (error) { this.pendingBuilds.add(projectId); throw error; }
  }

  revoke() { return this.configure({ enabled: false, allowedOrigins: [] }); }

  async revokeAndStop() {
    const context = this.context();
    const sessions = context.sessionId ? [this.services.sessions.require(context.sessionId)]
      : this.services.sessions.list({ projectId: context.projectId }).filter(session => session.profileId === context.profileId);
    this.revoke();
    const results = await Promise.allSettled(sessions.filter(session => session.live).map(session => this.services.settings.revoke(session.id)));
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Some applications could not stop after their grants were revoked');
  }
}

export function createRuntimeToolsBridge(options) { return new RuntimeToolsBridge(options); }

/** Explicit compatibility provider for hosts which have not composed application sessions yet. */
export function createLegacyRuntimeSettings({ state, save = () => {}, request }) {
  state.runtimeSettings = defaultSessionSettings();
  return {
    settings: () => ({ ...structuredClone(state.runtimeSettings), langVersion: state.langVersion ?? '14' }),
    configure(patch = {}) {
      const { langVersion, ...runtimePatch } = patch;
      const language = languageVersion(langVersion ?? state.langVersion ?? '14');
      state.runtimeSettings = validateSessionSettings({
        ...state.runtimeSettings, ...runtimePatch, compute: { ...state.runtimeSettings.compute, ...runtimePatch.compute }
      });
      state.langVersion = language;
      state.buildDirty = true;
      state.revision = (state.revision ?? 0) + 1;
      save();
      return this.settings();
    },
    launchOptions: () => sessionLaunchSettings(state.runtimeSettings),
    revoke() { state.runtimeSettings = { ...state.runtimeSettings, enabled: false, allowedOrigins: [] }; },
    async revokeAndStop() { this.revoke(); await request?.('stop'); }
  };
}
