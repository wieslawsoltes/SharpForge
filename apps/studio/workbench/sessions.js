import { DocumentService } from './documents.js';
import { BuildServices } from './build.js';
import { BuildQueue } from './build-queue.js';
import { SessionManager } from './session-manager.js';
import { OutputChannels } from './output-channels.js';
import { DiagnosticsStore } from './diagnostics-store.js';
import { StartupConfiguration } from './startup-config.js';
import { LaunchProfiles } from './launch-profiles.js';
import { LaunchOrchestrator } from './launch-orchestrator.js';
import { SessionSettings } from './session-settings.js';
import { SessionBreakpoints } from './session-breakpoints.js';
import { DocumentLocks } from './document-locks.js';
import { RevealPolicy } from './build-reveal.js';
import { createWorkspaceState } from './state.js';
import { createRuntimeFacade } from './session-compat.js';
import { routeSessionEvents } from './session-events.js';
import { workbenchError } from './state-events.js';

export { WorkerClient } from './worker-client.js';
export { DocumentService } from './documents.js';
export { BuildService, BuildServices } from './build.js';
export { SessionManager } from './session-manager.js';
export { AppSession } from './app-session.js';
export { createRuntimeFacade, legacyDebug, legacyRuntimeEvent } from './session-compat.js';

/** Application composition root. Every stateful service belongs to the returned workbench. */
export function createWorkbenchServices(options = {}) {
  const output = new OutputChannels(options.outputLimits);
  const diagnostics = new DiagnosticsStore(options.diagnosticLimits);
  const documents = new DocumentService({
    records: options.records, createEditor: options.createEditor, createModel: options.createModel ?? options.modelFactory,
    saveDocument: options.saveDocument, coordinateSave: options.coordinateDocumentSave
  });
  const defaultSnapshot = (projectId, project) => {
    const snapshot = project.snapshot ?? project;
    return {
      ...snapshot,
      files: (snapshot.files ?? []).map(file => {
        const document = documents.get(file.uri ?? file.path);
        return document ? { ...file, text: document.text, version: document.version } : file;
      })
    };
  };
  const builds = new BuildServices({
    workerFactory: options.workerFactory, compilerUrl: options.compilerUrl,
    snapshot: options.getProjectSnapshot ?? defaultSnapshot, requestCompiler: options.requestCompiler,
    output, diagnostics, onError: options.onError
  });
  const sessions = new SessionManager({
    maxSessions: options.maxSessions, workerFactory: options.workerFactory,
    runtimeUrl: options.runtimeUrl, output, onError: options.onError
  });
  const startup = new StartupConfiguration({ getProjects: () => builds.list().map(service => service.project), save: options.saveStartup });
  const profiles = new LaunchProfiles();
  const breakpoints = new SessionBreakpoints(sessions);
  const settings = new SessionSettings(sessions);
  const locks = new DocumentLocks(documents, sessions);
  const reveal = new RevealPolicy({
    reveal: options.onReveal,
    activeProject: () => builds.activeId,
    activeSession: () => sessions.activeId
  });
  const queue = new BuildQueue(builds, { output });
  const launches = new LaunchOrchestrator({
    builds, sessions, startup, profiles, breakpoints, output, queue,
    onApplication: options.onApplication, launchOptions: options.launchOptions, launchCapabilities: options.launchCapabilities
  });
  let workspaceState = null;
  const disposers = [
    documents.subscribe(event => {
      if (event.type !== 'changed') return;
      for (const projectId of documents.projectsFor(event.uri)) builds.get(projectId)?.invalidate('source');
    }),
    routeSessionEvents(sessions, options)
  ];
  const services = {
    documents, builds, sessions, output, diagnostics, startup, profiles, launches, queue, locks, breakpoints, settings, reveal,
    registerProject(project, { activate = false } = {}) {
      const service = builds.register(project);
      const snapshot = service.snapshot();
      documents.setProjectMembership(service.id, snapshot.files.map(file => file.uri));
      if (activate) builds.setActive(service.id);
      return service;
    },
    createStateFacade(initial) {
      if (workspaceState) throw new Error('This workbench already has a state facade');
      workspaceState = createWorkspaceState(initial, services);
      return workspaceState.state;
    },
    get stateSlices() { return workspaceState?.slices ?? null; },
    runtime: createRuntimeFacade(sessions, {
      createSession: () => {
        const project = builds.active?.project;
        if (!project) throw workbenchError('PROJECT_MISSING', 'Choose a project before launching');
        const profile = profiles.get(project.id);
        return sessions.create({
          projectId: project.id, name: project.name, profileId: profile.id,
          renderer: profile.renderer, runtimeSettings: profile.runtimeSettings
        });
      }
    }),
    compiler: {
      get worker() { return builds.active?.worker.worker ?? null; },
      get pending() { return builds.active?.worker.pending ?? new Map(); },
      request(method, params, requestOptions) {
        const build = builds.active;
        if (!build) return Promise.reject(workbenchError('PROJECT_MISSING', 'Choose a project before requesting compilation'));
        return build.request(method, params, requestOptions);
      }
    },
    dispose() {
      for (const dispose of disposers.splice(0)) dispose();
      workspaceState?.dispose();
      launches.dispose();
      queue.dispose();
      locks.dispose();
      breakpoints.dispose();
      settings.dispose();
      sessions.dispose();
      builds.dispose();
      documents.dispose();
      startup.dispose();
      profiles.dispose();
      diagnostics.dispose();
      output.dispose();
    }
  };
  for (const project of options.projects ?? []) services.registerProject(project);
  return services;
}
