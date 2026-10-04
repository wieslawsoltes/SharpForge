import { contributeCommands } from './commands.js';

export const projectContextActions = Object.freeze([
  'build', 'rebuild', 'clean', 'restore', 'evaluate', 'startup', 'edit-project',
  'solutionSetStartupProjects', 'projectDebugStartNewInstance'
]);

function invocationProject(invocation, services) {
  const argument = invocation.args?.[0];
  const explicit = typeof argument === 'string' ? argument : argument?.projectId;
  return explicit ?? invocation.projectId ?? services.builds.activeId;
}

function startAvailability(services, state, projectId) {
  if (state.nativeMode) {
    return 'Build with MSBuild, then Inspect IL to debug the supported managed assembly. Native process attachment is unavailable.';
  }
  if (state.hotEdit) return 'Apply or cancel Hot Reload edits before continuing';
  if (services.sessions.active?.launchBusy || services.launches.operations.size) return 'Wait for the current launch to finish';
  if (!projectId) return 'Open a project before starting an application';
  try {
    services.startup.validateProject(projectId);
    return true;
  } catch (error) {
    if (error.code === 'STARTUP_LIBRARY' || error.code === 'STARTUP_PROJECT_MISSING' || error instanceof TypeError) return error.message;
    throw error;
  }
}

/** Register shared startup actions; explicit invocation project ids never change startup or profile selection. */
export function registerStartupCommands(registry, {
  services, configure, configureProfiles, showProcesses, stopAll, startNewInstance, state = () => ({})
}) {
  const hasProjects = () => services.startup.projects().size > 0 || 'Open a project before configuring startup projects';
  const canStart = invocation => startAvailability(services, state(), invocationProject(invocation, services));
  const start = invocation => {
    const projectId = invocationProject(invocation, services);
    return startNewInstance ? startNewInstance(projectId) : services.launches.startNewInstance(projectId);
  };
  const canStop = () => services.sessions.list({ liveOnly: true }).length > 0 || services.launches.operations.size > 0 ||
    'No applications or launches are running';
  const stop = stopAll ?? (() => services.sessions.stopAll());
  const descriptor = (id, title, execute, enabled = true, category = 'Debug') => ({
    id, title, execute, enabled, category
  });
  return contributeCommands(registry, [
    descriptor('startup-projects', 'Set Startup Projects…', configure, hasProjects, 'Project'),
    descriptor('solutionSetStartupProjects', 'Set Startup Projects…', configure, hasProjects, 'Project'),
    descriptor('launch-profiles', 'Launch Profiles', configureProfiles, hasProjects, 'Project'),
    descriptor('processes', 'Processes', showProcesses),
    descriptor('stop-all', 'Stop All Applications', stop, canStop),
    descriptor('start-new-instance', 'Start New Instance', start, canStart),
    descriptor('projectDebugStartNewInstance', 'Start New Instance', start, canStart)
  ]);
}

/** Keep project lifecycle rows outside the legacy Explorer controller and reuse registered command availability. */
export function projectContextMenu({ node, context, action, canChange, commandState }) {
  if (node?.kind !== 'project' && node?.kind !== 'solution') return [];
  const current = context();
  const nativeReady = () => {
    const value = context();
    return !value.native || value.nativeAvailable && value.trusted && !value.buildBusy ? true :
      'Connect an available MSBuild engine and explicitly trust this workspace';
  };
  const available = id => () => {
    if (!commandState) return true;
    const command = commandState(id, node);
    return command?.enabled ? true : command?.disabledReason ?? false;
  };
  const items = [
    action('Build', 'build', 'Ctrl+Shift+B', nativeReady),
    action('Rebuild', 'rebuild', '', nativeReady),
    action('Clean', 'clean', '', nativeReady)
  ];
  if (current.native) {
    items.push(action('Restore Packages', 'restore', '', nativeReady), action('Evaluate Project', 'evaluate', '', nativeReady));
  }
  if (node.kind === 'project') {
    const canStart = available('projectDebugStartNewInstance');
    items.push(action('Set as Startup Project', 'startup', '', canChange), {
      label: 'Debug', enabled: canStart,
      children: [action('Start New Instance', 'projectDebugStartNewInstance', '', canStart)]
    }, action('Edit Project File', 'edit-project', '', !!node.path));
  } else {
    items.push(action('Set Startup Projects…', 'solutionSetStartupProjects', '', available('solutionSetStartupProjects')));
    if (node.path) items.push(action('Edit Solution File', 'open'));
  }
  items.push(null);
  return items;
}
