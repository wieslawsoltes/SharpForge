import { WorkbenchEvents, abortError, workbenchError } from './state-events.js';
import { projectBuildOrder } from './build-queue.js';

/** Independent startup roots may fail separately; dependencies always build before their roots. */
export class LaunchOrchestrator {
  constructor({ builds, sessions, startup, profiles, breakpoints, output, onApplication, launchOptions = () => ({}) }) {
    Object.assign(this, { builds, sessions, startup, profiles, breakpoints, output, onApplication, launchOptions });
    this.events = new WorkbenchEvents();
    this.operations = new Map();
    this.nextId = 0;
  }

  subscribe(listener, options) { return this.events.subscribe(listener, options); }

  async start({ debug = true, currentProjectId, entries, signal, activate = true, ...overrides } = {}) {
    const targets = entries ?? this.startup.resolve({ debug, currentProjectId });
    if (!targets.length) throw workbenchError('STARTUP_EMPTY', 'Choose at least one startup project');
    const controller = new AbortController();
    const id = `launch:${++this.nextId}`;
    const operation = { id, controller, targets };
    const cancel = () => controller.abort(signal.reason);
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
    const result = { id, started: [], failed: [], cancelled: [] };
    const buildResults = new Map();
    this.operations.set(id, operation);
    this.events.emit({ type: 'starting', operation });
    try {
      for (const target of targets) {
        if (controller.signal.aborted) { result.cancelled.push(target.projectId); continue; }
        try {
          const order = projectBuildOrder([target.projectId], projectId => this.builds.get(projectId)?.project);
          for (const projectId of order) {
            if (controller.signal.aborted) throw abortError(controller.signal.reason);
            if (!buildResults.has(projectId)) {
              try {
                buildResults.set(projectId, await this.builds.get(projectId).build({ signal: controller.signal, background: !activate }));
              } catch (error) { buildResults.set(projectId, { success: false, error }); }
            }
            if (!buildResults.get(projectId).success) {
              throw workbenchError('STARTUP_BUILD_FAILED', `Cannot start '${target.projectId}': build '${projectId}' failed`, buildResults.get(projectId).error);
            }
          }
          if (controller.signal.aborted) throw abortError(controller.signal.reason);
          const application = await this.launchBuilt(target, buildResults.get(target.projectId), { ...overrides, debug, signal: controller.signal });
          result.started.push(application.id);
          if (activate && result.started.length === 1) this.sessions.setActive(application.id);
        } catch (error) {
          const failure = { projectId: target.projectId, error };
          if (controller.signal.aborted || error.name === 'AbortError') result.cancelled.push(target.projectId);
          else result.failed.push(failure);
          this.output?.append('Debug', `${target.projectId}: ${error.message}\n`, { projectId: target.projectId, severity: 'error' });
          this.events.emit({ type: 'failed', operation, ...failure });
        }
      }
      this.events.emit({ type: 'completed', operation, result });
      return result;
    } finally {
      signal?.removeEventListener('abort', cancel);
      this.operations.delete(id);
    }
  }

  async launchBuilt(target, built, options) {
    const service = this.builds.get(target.projectId);
    const profile = this.profiles.get(target.projectId, target.profile);
    const session = this.sessions.create({
      projectId: target.projectId, name: service.project.name ?? target.projectId,
      renderer: profile.renderer, runtimeSettings: profile.runtimeSettings
    }, { activate: false });
    try {
      const providerOptions = await this.launchOptions(target.projectId, profile, built);
      if (options.signal?.aborted) throw abortError(options.signal.reason);
      const { signal, ...launchOverrides } = options;
      const debugging = options.debug !== false && target.debug !== false && target.action !== 'startWithoutDebugging';
      await this.onApplication?.(session);
      await session.launch({
        assembly: built.assembly,
        pdb: built.pdb,
        ...this.profiles.launchOptions(target.projectId, target.profile),
        ...providerOptions,
        ...launchOverrides,
        debug: debugging,
        breakpoints: this.breakpoints?.forProject(target.projectId) ?? providerOptions.breakpoints ?? {},
        stopOnEntry: debugging && (options.stopOnEntry ?? profile.stopOnEntry)
      }, { signal });
      return session;
    } catch (error) {
      this.sessions.remove(session.id);
      throw error;
    }
  }

  startNewInstance(projectId, options = {}) {
    this.startup.validateProject(projectId);
    return this.start({ ...options, entries: [{ projectId, action: 'start', profile: options.profile ?? 'default', debug: options.debug !== false }] });
  }

  cancel(id) {
    const operation = this.operations.get(id);
    operation?.controller.abort(abortError('Startup cancelled'));
    return !!operation;
  }

  dispose() {
    for (const operation of this.operations.values()) operation.controller.abort(abortError('Launch service disposed'));
    this.events.dispose();
  }
}
