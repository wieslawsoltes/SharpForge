import { ApplicationWindows } from './application-window.js';
import { mountStartupTarget } from './startup-target.js';
import { createStartupDialog } from './startup-dialog.js';
import { mountProcesses } from './processes.js';
import { DebugLocation, mountDebugLocation } from './debug-location.js';
import { mountSessionStatus } from './session-status.js';

/** Connect per-app services to document windows, process tools and the existing Studio toolbar. */
export function mountStudioSessions({ services, docking, commands, document, onError, navigate, refresh }) {
  const disposers = [];
  const applications = new ApplicationWindows({
    sessions: services.sessions, document,
    registerPanel: panel => docking.registerPanel({ ...panel, activate: services.sessions.activeId === panel.element.dataset.appSession }),
    unregisterPanel: id => docking.unregisterPanel(id), onError
  });
  disposers.push(() => applications.dispose());
  const startupRoot = document.createElement('div');
  startupRoot.className = 'sf-startup-target';
  document.querySelector('#start')?.parentElement.append(startupRoot);
  const dialogs = new Set();
  const configure = () => {
    const previous = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Set Startup Projects');
    const close = () => dialog.close();
    dialog.append(createStartupDialog(document, services.startup, { onApply: close, onCancel: close }));
    dialog.addEventListener('close', () => { dialogs.delete(dialog); dialog.remove(); previous?.focus(); }, { once: true });
    document.body.append(dialog);
    dialogs.add(dialog);
    dialog.showModal();
    return dialog;
  };
  disposers.push(() => { for (const dialog of dialogs) dialog.close(); });
  const target = mountStartupTarget(startupRoot, { startup: services.startup, profiles: services.profiles, onConfigure: configure, onError });
  disposers.push(() => target.dispose(), () => startupRoot.remove());
  const locationRoot = document.createElement('div');
  locationRoot.className = 'sf-debug-location-toolbar';
  locationRoot.setAttribute('aria-label', 'Debug location');
  document.querySelector('.editor-breadcrumb')?.before(locationRoot);
  const location = new DebugLocation(services.sessions, { onNavigate: navigate, onChanged: refresh });
  const locationView = mountDebugLocation(locationRoot, { sessions: services.sessions, location, onError });
  disposers.push(() => locationView.dispose(), () => locationRoot.remove());
  const processesRoot = document.createElement('div');
  processesRoot.className = 'panel-content';
  const processes = mountProcesses(processesRoot, { sessions: services.sessions, onError });
  const unregisterProcesses = docking.registerPanel({ id: 'processes', title: 'Processes', element: processesRoot, activate: false });
  docking.layout.close('processes');
  disposers.push(() => processes.dispose(), unregisterProcesses);
  const statusRoot = document.createElement('span');
  document.querySelector('.statusbar')?.append(statusRoot);
  const status = mountSessionStatus(statusRoot, services.sessions);
  disposers.push(() => status.dispose(), () => statusRoot.remove());
  const registrations = [
    ['startup-projects', 'Configure Startup Projects', configure],
    ['processes', 'Processes', () => docking.activate('processes')],
    ['stop-all', 'Stop All Applications', () => services.sessions.stopAll()],
    ['start-new-instance', 'Start New Instance', () => services.launches.startNewInstance(services.builds.activeId)]
  ];
  for (const [id, title, action] of registrations) {
    if (commands.list().some(value => value[0] === id)) continue;
    const off = commands.registerCommand(id, title, '', action, { category: 'Debug' });
    if (typeof off === 'function') disposers.push(off);
  }
  return {
    applications, location, configure,
    refresh() { target.render(); locationView.render(); processes.render(); },
    dispose() { for (const dispose of disposers.reverse()) dispose(); }
  };
}
