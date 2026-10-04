import { ApplicationWindows } from './application-window.js';
import { mountStartupTarget } from './startup-target.js';
import { mountProcesses } from './processes.js';
import { DebugLocation, mountDebugLocation } from './debug-location.js';
import { mountSessionStatus } from './session-status.js';
import { createSessionDialogs } from './session-dialogs.js';
import { registerStartupCommands } from './startup-commands.js';

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
  const { services, docking, commands, document, onError } = options;
  const disposers = [];
  const applications = new ApplicationWindows({
    sessions: services.sessions, document,
    registerPanel: panel => {
      const unregister = docking.registerPanel({ ...panel, activate: false });
      const sessionId = panel.element.dataset.appSession;
      const activate = () => docking.activate(panel.id);
      if (options.revealApplication) options.revealApplication(sessionId, activate);
      else if (services.sessions.activeId === sessionId) activate();
      return unregister;
    },
    unregisterPanel: id => docking.unregisterPanel(id), onError
  });
  disposers.push(() => applications.dispose());
  const dialogs = createSessionDialogs(options);
  const target = mountTarget({ ...options, dialogs });
  const location = mountLocation(options);
  const processes = mountProcessTool(options);
  const status = mountStatus(options);
  for (const view of [dialogs, target, location, processes, status]) disposers.push(() => view.dispose());
  disposers.push(registerStartupCommands(commands, {
    ...options, configure: dialogs.configure, configureProfiles: dialogs.configureProfiles,
    showProcesses: () => docking.activate('processes')
  }));
  return {
    applications, location: location.location, configure: dialogs.configure,
    refresh() { target.render(); location.render(); processes.render(); },
    dispose() { for (const dispose of disposers.reverse()) dispose(); }
  };
}
