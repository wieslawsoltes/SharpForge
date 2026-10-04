import { WorkbenchEvents, abortError, workbenchError } from './state-events.js';
import { projectBuildOrder } from './build-queue.js';
import { runtimeLaunchCapabilities } from '@sharpforge/runtime';

/** Independent startup roots may fail separately; dependencies always build before their roots. */
export class LaunchOrchestrator {
  constructor({ builds, sessions, startup, profiles, breakpoints, output, queue, onApplication,
    launchOptions = () => ({}), launchCapabilities = () => runtimeLaunchCapabilities }) {
    Object.assign(this, { builds, sessions, startup, profiles, breakpoints, output, queue, onApplication, launchOptions, launchCapabilities });
    this.events = new WorkbenchEvents();
    this.operations = new Map();
    this.nextId = 0;
  }

  subscribe(listener, options) { return this.events.subscribe(listener, options); }

  /** shouldActivate(session) synchronously guards first-app selection after launch; it never enters worker launch options. */
  async start({ debug = true, currentProjectId, entries, signal, activate = true, shouldActivate = () => true, ...overrides } = {}) {
    if (this.operations.size >= 128) throw workbenchError('LAUNCH_QUEUE_LIMIT', 'Launch operation limit reached');
    if (typeof shouldActivate !== 'function') throw new TypeError('Launch activation guard must be a function');
    const targets = entries ?? this.startup.resolve({
      debug, currentProjectId, currentProfileId: this.profiles.selected.get(currentProjectId) ?? 'default'
    });
    if (!Array.isArray(targets) || !targets.length || targets.length > 1024) {
      throw workbenchError('STARTUP_EMPTY', 'Choose between one and 1024 startup projects');
    }
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
                const build = () => this.builds.get(projectId).build({ signal: controller.signal, background: !activate });
                const result = this.queue ? await this.queue.runProject(projectId, operation, build) : await build();
                buildResults.set(projectId, result);
              } catch (error) { buildResults.set(projectId, { success: false, error }); }
            }
            if (!buildResults.get(projectId).success) {
              const message = `Cannot start '${target.projectId}': build '${projectId}' failed`;
              throw workbenchError('STARTUP_BUILD_FAILED', message, buildResults.get(projectId).error);
            }
          }
          if (controller.signal.aborted) throw abortError(controller.signal.reason);
          const application = await this.launchBuilt(target, buildResults.get(target.projectId), { ...overrides, debug, signal: controller.signal });
          result.started.push(application.id);
          if (activate && result.started.length === 1 && shouldActivate(application)) this.sessions.setActive(application.id);
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
      profileId: profile.id, renderer: profile.renderer, runtimeSettings: profile.runtimeSettings
    }, { activate: false });
    try {
      const providerOptions = await this.launchOptions(target.projectId, profile, built);
      if (options.signal?.aborted) throw abortError(options.signal.reason);
      const { signal, ...launchOverrides } = options;
      const debugging = options.debug !== false && target.debug !== false && target.action !== 'startWithoutDebugging';
      const launch = {
        assembly: built.assembly,
        pdb: built.pdb,
        ...this.profiles.launchOptions(target.projectId, target.profile),
        ...providerOptions,
        ...launchOverrides,
        debug: debugging,
        breakpoints: this.breakpoints?.forProject(target.projectId) ?? providerOptions.breakpoints ?? {},
        stopOnEntry: debugging && (options.stopOnEntry ?? profile.stopOnEntry)
      };
      const capabilities = await this.launchCapabilities(target.projectId, profile, built, launch);
      if (launch.programArguments?.length && !capabilities.arguments) {
        throw workbenchError('LAUNCH_CAPABILITY', 'This launch target does not support program arguments');
      }
      if (Object.keys(launch.environment ?? {}).length && !capabilities.environment) {
        throw workbenchError('LAUNCH_CAPABILITY', 'This launch target does not support a per-application environment');
      }
      if (signal?.aborted) throw abortError(signal.reason);
      await this.onApplication?.(session);
      await session.launch(launch, { signal });
      return session;
    } catch (error) {
      this.sessions.remove(session.id);
      throw error;
    }
  }

  startNewInstance(projectId, options = {}) {
    this.startup.validateProject(projectId);
    return this.start({
      ...options,
      entries: [{ projectId, action: 'start', profile: options.profile ?? this.profiles.selected.get(projectId) ?? 'default', debug: options.debug !== false }]
    });
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
