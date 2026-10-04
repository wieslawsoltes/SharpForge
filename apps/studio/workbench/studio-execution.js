import { StudioReveals } from './studio-reveals.js';

/** Coordinates Studio actions without changing the selected project for background work. */
export class StudioExecution {
  constructor({ services, projects, state, ui }) {
    Object.assign(this, { services, projects, state, ui });
    this.launchController = null;
    this.launchReveal = null;
    this.reveals = new StudioReveals(services);
  }

  async analyze() {
    const state = this.state();
    if (state.recoveryReadOnly || state.nativeMode && !state.nativeProjectContext) return null;
    const service = this.projects.serviceFor(state.active);
    try {
      const result = await service.analyze();
      if (result && this.services.builds.activeId === service.id) this.ui.applyAnalysis(result, service.id);
      return result;
    } catch (error) {
      if (!['BUILD_STALE', 'WORKER_RESTARTED'].includes(error.code) && error.name !== 'AbortError') this.ui.error(error);
      return null;
    }
  }

  async build(silent = false, { revealIntent } = {}) {
    const state = this.state();
    if (state.recoveryReadOnly) throw new Error('Grant folder access before building recovered files');
    if (silent && [...this.services.documents.models.values()].some(model => model.buffer.length > 8 * 1024 * 1024)) {
      this.ui.status('Large file mode — automatic build disabled');
      return null;
    }
    if (state.nativeMode) {
      if (silent) return null;
      this.services.reveal.request('msbuild', revealIntent ?? this.reveals.begin());
      return this.ui.nativeBuild().run('build');
    }
    const service = this.projects.serviceFor(null);
    if (!this.projects.sourceUris(service.id).length) {
      this.ui.status('Ready — no source to build');
      return null;
    }
    if (state.importedAssembly && !service.dirty) return service.result;
    const ticket = revealIntent ?? this.reveals.begin({ background: silent, projectId: service.id });
    if (!silent) this.ui.status('Building…');
    try {
      const summary = await this.services.queue.run([service.id], { background: silent });
      const result = summary.results.get(service.id);
      if (!result || result.error) {
        if (result?.error) throw result.error;
        return null;
      }
      if (this.services.builds.activeId !== service.id) return result;
      this.ui.applyAnalysis(result, service.id);
      if (result.success) {
        state.ilDump = null;
        state.importedAssembly = false;
        state.selectedMethod = result.image?.methods.find(method => !method.name.startsWith('<'))?.id ?? result.image?.entryPoint;
        this.ui.refresh();
      } else this.services.reveal.request('problems', ticket);
      return result;
    } catch (error) {
      if (this.services.builds.activeId === service.id) this.ui.status(error.code === 'BUILD_STALE' ? 'Source changed during build' : 'Build failed');
      if (error.code !== 'BUILD_STALE' && error.name !== 'AbortError') this.ui.error(error);
      return null;
    }
  }

  async launch(debug = true, options = {}) {
    const state = this.state();
    if (state.recoveryReadOnly) throw new Error('Grant folder access before running recovered files');
    const active = this.services.sessions.active;
    if (state.hotEdit) throw new Error('Apply or cancel Hot Reload edits before continuing');
    if (this.launchController || active?.launchBusy) return null;
    if (debug && active?.state === 'paused' && !options.newInstance) {
      this.reveals.follow(active, this.reveals.begin());
      return active.request('resume', { mode: 'continue' });
    }
    if (active?.live && !options.newInstance) return null;
    if (state.nativeMode) {
      this.services.reveal.request('msbuild', this.reveals.begin());
      if (!debug) return this.ui.nativeBuild().runProject();
      throw new Error('Build with MSBuild, then Inspect IL to debug the supported managed assembly. Native process attachment is unavailable.');
    }
    this.projects.sync();
    const ticket = this.reveals.begin();
    const project = this.services.builds.active?.project;
    if (!options.newInstance && project?.outputType?.toLowerCase() === 'library' && this.services.startup.entries.length < 2) {
      const result = await this.build(false, { revealIntent: ticket });
      if (result?.success && this.services.reveal.request('assembly', ticket)) await this.ui.openAssembly(result.assembly);
      return result;
    }
    const controller = new AbortController();
    this.launchController = controller;
    this.launchReveal = ticket;
    this.ui.setBusy(true);
    this.projects.primeBreakpoints();
    try {
      const result = await this.services.launches.start({
        ...options, debug, signal: controller.signal, currentProjectId: this.projects.currentProjectId ?? this.projects.selectedId,
        shouldActivate: session => this.reveals.canActivate(ticket, session)
      });
      for (const failure of result.failed) this.ui.error(failure.error);
      const service = this.services.builds.active;
      if (service?.result) this.ui.applyAnalysis(service.result, service.id);
      if (result.started.length) this.services.reveal.request(debug ? 'debug' : 'output', { ...ticket, sessionId: result.started[0] });
      return result;
    } finally {
      if (this.launchController === controller) { this.launchController = null; this.launchReveal = null; }
      this.ui.setBusy(false);
    }
  }

  followLaunch(session) {
    if (this.launchReveal) this.reveals.follow(session, this.launchReveal, { starting: true });
  }

  async restart() {
    const session = this.services.sessions.active;
    if (!session) return this.launch(true);
    const ticket = this.reveals.begin();
    this.reveals.follow(session, ticket, { starting: true });
    try {
      const result = await session.restart();
      if (this.services.reveal.allows(ticket)) this.services.sessions.setActive(session.id);
      return result;
    } finally { this.reveals.clearStarting(session, ticket); }
  }

  startNewInstance(projectId = this.projects.selectedId, options = {}) {
    this.projects.sync();
    this.services.startup.validateProject(projectId);
    const profile = options.profile ?? this.services.profiles.selected.get(projectId) ?? 'default';
    return this.launch(options.debug !== false, {
      ...options, newInstance: true, entries: [{ projectId, action: 'start', profile }]
    });
  }

  async stop({ all = false } = {}) {
    this.services.reveal.userIntent();
    this.launchController?.abort('Stopped by user');
    for (const operation of this.services.launches.operations.values()) {
      if (all || operation.targets.some(target => target.projectId === this.services.sessions.active?.projectId)) {
        this.services.launches.cancel(operation.id);
      }
    }
    if (all) await this.services.sessions.stopAll();
    else await this.services.sessions.active?.stop();
    this.services.locks.refresh();
    this.ui.stopped();
  }

  dispose() {
    this.launchController?.abort('Studio execution disposed');
    this.reveals.dispose();
  }
}
