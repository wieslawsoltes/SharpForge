import { selectField, replaceOptions } from './session-dom.js';

/** Host this beside Start; selecting a project updates the same configuration used by F5. */
export function mountStartupTarget(root, { startup, profiles, onConfigure, onError = error => { throw error; } }) {
  const document = root.ownerDocument;
  const target = selectField(document, 'Startup target');
  const profile = selectField(document, 'Launch profile');
  root.append(target.wrapper, profile.wrapper);
  const controller = new AbortController();
  const render = () => {
    const projects = [...startup.projects()].filter(([, value]) => String(value.outputType ?? value.outputKind).toLowerCase() !== 'library');
    const current = startup.mode === 'multiple' ? '$multiple' : startup.mode === 'currentSelection' ? '$selection' : startup.entries[0]?.projectId;
    replaceOptions(target.select, [
      ...projects.map(([id, value]) => ({ value: id, label: value.name ?? id })),
      { value: '$multiple', label: 'Multiple startup projects…' }, { value: '$selection', label: 'Current selection' }
    ], current);
    const projectId = startup.mode === 'single' ? startup.entries[0]?.projectId : null;
    profile.wrapper.hidden = !projectId;
    if (projectId) replaceOptions(profile.select, profiles.list(projectId).map(value => ({ value: value.id, label: value.name })),
      startup.entries[0].profile ?? profiles.selected.get(projectId) ?? 'default');
  };
  target.select.addEventListener('change', () => {
    try {
      const value = target.select.value;
      if (value === '$multiple') {
        startup.configure({ mode: 'multiple' });
        onConfigure?.();
      } else if (value === '$selection') startup.configure({ mode: 'currentSelection' });
      else startup.select(value, { profile: profiles.selected.get(value) ?? 'default' });
      render();
    } catch (error) { onError(error); }
  }, { signal: controller.signal });
  profile.select.addEventListener('change', () => {
    try {
      const projectId = startup.entries[0]?.projectId;
      const profileId = profile.select.value;
      const debug = startup.entries[0]?.action !== 'startWithoutDebugging';
      profiles.select(projectId, profileId);
      startup.select(projectId, { profile: profileId, debug });
    } catch (error) { onError(error); }
  }, { signal: controller.signal });
  const disposers = [startup.subscribe(render), profiles.subscribe(render)];
  render();
  return {
    render,
    dispose() {
      controller.abort();
      for (const dispose of disposers) dispose();
      target.wrapper.remove();
      profile.wrapper.remove();
    }
  };
}
