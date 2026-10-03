import { element, actionButton, selectField, replaceOptions } from './session-dom.js';

/** Render into the application's accessible dialog host; edits commit only on Apply. */
export function createStartupDialog(document, startup, { profiles, onApply, onCancel = () => {} } = {}) {
  const root = element(document, 'form', null, { class: 'tool-page startup-dialog', 'aria-label': 'Set Startup Projects' });
  root.append(element(document, 'h2', 'Set Startup Projects'));
  const mode = selectField(document, 'Startup mode');
  replaceOptions(mode.select, [
    { value: 'single', label: 'Single startup project' },
    { value: 'multiple', label: 'Multiple startup projects' },
    { value: 'currentSelection', label: 'Current selection' }
  ], startup.mode);
  const status = element(document, 'p', '', { role: 'status', 'aria-live': 'polite' });
  const rows = element(document, 'div', null, { role: 'list', 'aria-label': 'Startup order' });
  const projects = startup.projects();
  const draft = startup.entries.map(entry => ({ ...entry }));
  for (const [projectId] of projects) {
    if (!draft.some(entry => entry.projectId === projectId)) draft.push({ projectId, action: 'none', profile: 'default' });
  }
  const render = () => {
    rows.replaceChildren(...draft.map((entry, index) => {
      const project = projects.get(entry.projectId);
      const row = element(document, 'div', null, { role: 'listitem', class: 'panel-tools' });
      row.append(element(document, 'span', project.name ?? entry.projectId));
      const action = selectField(document, `Action for ${project.name ?? entry.projectId}`);
      replaceOptions(action.select, [
        { value: 'none', label: 'None' }, { value: 'start', label: 'Start' },
        { value: 'startWithoutDebugging', label: 'Start without debugging' }
      ], entry.action);
      action.select.disabled = String(project.outputType ?? project.outputKind).toLowerCase() === 'library';
      action.select.addEventListener('change', () => { entry.action = action.select.value; });
      const move = direction => {
        const target = index + direction;
        if (target < 0 || target >= draft.length) return;
        [draft[index], draft[target]] = [draft[target], draft[index]];
        render();
      };
      const up = actionButton(document, 'Move up', () => move(-1), error => { status.textContent = error.message; });
      const down = actionButton(document, 'Move down', () => move(1), error => { status.textContent = error.message; });
      up.disabled = index === 0;
      down.disabled = index === draft.length - 1;
      row.append(action.wrapper, up, down);
      if (profiles) {
        const profile = selectField(document, `Profile for ${project.name ?? entry.projectId}`);
        replaceOptions(profile.select, profiles.list(entry.projectId).map(value => ({ value: value.id, label: value.name })), entry.profile);
        profile.select.addEventListener('change', () => { entry.profile = profile.select.value; });
        row.append(profile.wrapper);
      }
      return row;
    }));
  };
  const apply = element(document, 'button', 'Apply', { type: 'submit', class: 'button primary' });
  const cancel = actionButton(document, 'Cancel', onCancel, error => { status.textContent = error.message; });
  root.append(mode.wrapper, rows, status, apply, cancel);
  root.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const value = startup.configure({ mode: mode.select.value, entries: draft.map((entry, order) => ({ ...entry, order })) });
      Promise.resolve(onApply?.(value)).catch(error => { status.textContent = error.message; });
    } catch (error) { status.textContent = error.message; }
  });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
  });
  render();
  return root;
}
