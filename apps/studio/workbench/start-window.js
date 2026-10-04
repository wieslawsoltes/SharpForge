import {button, checkbox, element, runAction} from './ui.js';

export function showStartWindow({dialogs, recent, settings, execute, openRecent, onError}) {
  return dialogs.open({title: 'Start SharpForge Studio', render: (host, dialog) => {
    const document = host.ownerDocument;
    const layout = element(document, 'div', {className: 'wb-start-layout'});
    const projects = element(document, 'section', {'aria-label': 'Recent projects and solutions'});
    const actions = element(document, 'section', {className: 'wb-start-actions'});
    projects.append(element(document, 'h3', {text: 'Recent projects and solutions'}));
    const render = () => {
      projects.replaceChildren(element(document, 'h3', {text: 'Recent projects and solutions'}));
      for (const item of recent.list('project')) {
        const row = element(document, 'div', {className: 'wb-recent-row'});
        row.append(button(document, item.label, runAction(async () => {
          const result = await openRecent(item);
          if (result === false) { recent.remove(item.uri); render(); return; }
          dialog.close(true);
        }, onError)), button(document, item.pinned ? 'Unpin' : 'Pin', () => { recent.pin(item.uri, !item.pinned); render(); }),
        button(document, 'Remove', () => { recent.remove(item.uri); render(); }));
        projects.append(row);
      }
      if (!recent.list('project').length) projects.append(element(document, 'p', {text: 'Projects you open appear here.'}));
    };
    const commands = [['Open a project or solution', 'open'], ['Open a local folder', 'openFolder'],
      ['Create a new project', 'newProject']];
    for (const [label, command] of commands) actions.append(button(document, label, runAction(async () => {
      dialog.close(true); await execute(command);
    }, onError)));
    actions.append(button(document, 'Continue without code', () => dialog.close(true)));
    actions.append(checkbox(document, 'Show this window on startup', settings.get('environment', 'showStartWindow'),
      value => settings.apply({environment: {showStartWindow: value}})));
    layout.append(projects, actions); host.append(layout); render();
  }, actions: []});
}
