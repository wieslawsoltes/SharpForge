import { ApplicationWindows } from './application-window.js';
import { mountStartupTarget } from './startup-target.js';
import { mountProcesses } from './processes.js';
import { DebugLocation, mountDebugLocation } from './debug-location.js';
import { mountSessionStatus } from './session-status.js';
import { createSessionDialogs } from './session-dialogs.js';

function mountTarget({ document, services, dialogs, onError }) {
  const root = document.createElement('div');
  root.className = 'sf-startup-target';
  document.querySelector('#start')?.parentElement.append(root);
  const target = mountStartupTarget(root, {
    startup: services.startup, profiles: services.profiles, onConfigure: dialogs.configure, onError
  });
  const button = document.createElement('button');
  button.textContent = 'Launch Profiles';
  button.className = 'toolbar-button';
  button.addEventListener('click', () => { try { dialogs.configureProfiles(); } catch (error) { onError(error); } });
  root.append(button);
  return { render: () => target.render(), dispose() { target.dispose(); root.remove(); } };
}

function mountLocation({ document, services, navigate, refresh, onError }) {
  const root = document.createElement('div');
  root.className = 'sf-debug-location-toolbar';
  root.setAttribute('aria-label', 'Debug location');
  document.querySelector('.editor-breadcrumb')?.before(root);
  const location = new DebugLocation(services.sessions, { onNavigate: navigate, onChanged: refresh });
  const view = mountDebugLocation(root, { sessions: services.sessions, location, onError });
  return { location, render: () => view.render(), dispose() { view.dispose(); root.remove(); } };
}

function mountProcessTool({ document, services, docking, onError }) {
  const root = document.createElement('div');
  root.className = 'panel-content';
  const view = mountProcesses(root, { sessions: services.sessions, onError });
  const unregister = docking.registerPanel({ id: 'processes', title: 'Processes', element: root, activate: false });
  docking.layout.close('processes');
  return { render: () => view.render(), dispose() { view.dispose(); unregister(); } };
}

function mountStatus({ document, services }) {
  const root = document.createElement('span');
  document.querySelector('.statusbar')?.append(root);
  const status = mountSessionStatus(root, services.sessions, {
    title: document.title, setTitle: value => { document.title = value; }
  });
  return { dispose() { status.dispose(); root.remove(); } };
}

/** Connect application services to document windows and the Studio toolbar through explicit host actions. */
export function mountStudioSessions(options) {
  const { services, docking, commands, document, onError, stopAll, startNewInstance } = options;
  const disposers = [];
  const applications = new ApplicationWindows({
    sessions: services.sessions, document,
    registerPanel: panel => docking.registerPanel({
      ...panel, activate: services.sessions.activeId === panel.element.dataset.appSession
    }),
    unregisterPanel: id => docking.unregisterPanel(id), onError
  });
  disposers.push(() => applications.dispose());
  const dialogs = createSessionDialogs(options);
  const target = mountTarget({ ...options, dialogs });
  const location = mountLocation(options);
  const processes = mountProcessTool(options);
  const status = mountStatus(options);
  for (const view of [dialogs, target, location, processes, status]) disposers.push(() => view.dispose());
  const registrations = [
    ['startup-projects', 'Configure Startup Projects', dialogs.configure],
    ['launch-profiles', 'Launch Profiles', dialogs.configureProfiles],
    ['processes', 'Processes', () => docking.activate('processes')],
    ['stop-all', 'Stop All Applications', stopAll ?? (() => services.sessions.stopAll())],
    ['start-new-instance', 'Start New Instance',
      startNewInstance ?? (() => services.launches.startNewInstance(services.builds.activeId))]
  ];
  for (const [id, title, action] of registrations) {
    if (commands.list().some(value => value[0] === id)) continue;
    const off = commands.registerCommand(id, title, '', action, { category: 'Debug' });
    if (typeof off === 'function') disposers.push(off);
  }
  return {
    applications, location: location.location, configure: dialogs.configure,
    refresh() { target.render(); location.render(); processes.render(); },
    dispose() { for (const dispose of disposers.reverse()) dispose(); }
  };
}
