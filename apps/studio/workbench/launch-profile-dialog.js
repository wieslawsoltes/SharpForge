import { element, selectField, replaceOptions, actionButton } from './session-dom.js';

/** Parse literal launch fields without a shell, expansion, or access to the host environment. */
export function parseLaunchFields(argumentsText, environmentText) {
  if (argumentsText.length > 1_048_576 || environmentText.length > 1_048_576) throw new RangeError('Launch fields exceed 1 MiB');
  const args = JSON.parse(argumentsText || '[]');
  if (!Array.isArray(args) || args.length > 1024 || args.some(value => typeof value !== 'string' || value.length > 65_536)) {
    throw new TypeError('Arguments must be a JSON array of at most 1024 strings');
  }
  const environment = Object.create(null);
  for (const line of environmentText.split(/\r?\n/).filter(line => line.trim())) {
    const equals = line.indexOf('=');
    const key = line.slice(0, equals).trim();
    if (equals < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new TypeError('Use NAME=value for each environment entry');
    if (Object.hasOwn(environment, key)) throw new TypeError(`Duplicate environment name '${key}'`);
    const value = line.slice(equals + 1);
    if (value.length > 65_536) throw new RangeError('An environment value exceeds 64 KiB');
    environment[key] = value;
  }
  if (Object.keys(environment).length > 256) throw new RangeError('At most 256 environment entries are supported');
  return { arguments: args, environment };
}

/** Profiles are edited locally and apply to subsequent launches of the selected project. */
export function createLaunchProfileDialog(document, { profiles, projectId, onApply, onCancel }) {
  const form = element(document, 'form', null, { class: 'tool-page', 'aria-label': 'Launch Profiles' });
  const picker = selectField(document, 'Profile');
  const existing = profiles.list(projectId);
  replaceOptions(picker.select, [...existing.map(profile => ({ value: profile.id, label: profile.name })),
    { value: '$new', label: 'New profile…' }], profiles.selected.get(projectId) ?? 'default');
  const field = (label, type = 'input') => {
    const wrapper = element(document, 'label', label, { class: 'tool-field' });
    const input = element(document, type, null, { 'aria-label': label });
    if (type === 'textarea') { input.rows = 5; input.spellcheck = false; }
    wrapper.append(input);
    return { wrapper, input };
  };
  const name = field('Profile name');
  name.input.maxLength = 128;
  const args = field('Arguments (JSON array)', 'textarea');
  const environment = field('Environment (NAME=value per line)', 'textarea');
  const renderer = selectField(document, 'Renderer');
  replaceOptions(renderer.select, ['auto', 'webgpu', 'canvas2d', 'dom'].map(value => ({ value, label: value })), 'auto');
  const stop = field('Stop on entry');
  stop.input.type = 'checkbox';
  const status = element(document, 'p', '', { role: 'status' });
  let current;
  const load = () => {
    current = picker.select.value === '$new' ? profiles.validate({ id: 'new-profile' }) : profiles.get(projectId, picker.select.value);
    name.input.value = picker.select.value === '$new' ? '' : current.name;
    args.input.value = JSON.stringify(current.arguments);
    environment.input.value = Object.entries(current.environment).map(([key, value]) => `${key}=${value}`).join('\n');
    renderer.select.value = current.renderer;
    stop.input.checked = current.stopOnEntry;
  };
  picker.select.addEventListener('change', load);
  form.append(element(document, 'h2', 'Launch Profiles'), picker.wrapper, name.wrapper, args.wrapper,
    environment.wrapper, renderer.wrapper, stop.wrapper,
    element(document, 'p', 'Arguments and environment values stay in this workspace session and apply on the next launch.'), status);
  const apply = element(document, 'button', 'Save profile', { type: 'submit', class: 'button primary' });
  form.append(apply, actionButton(document, 'Cancel', onCancel, error => { status.textContent = error.message; }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const label = name.input.value.trim();
      if (!label || label === '$new') throw new TypeError('A profile name other than $new is required');
      const id = picker.select.value === '$new' ? label : picker.select.value;
      if (picker.select.value === '$new' && existing.some(profile => profile.id === id)) throw new Error('That profile already exists');
      const fields = parseLaunchFields(args.input.value, environment.input.value);
      const profile = profiles.set(projectId, {
        ...current, ...fields, id, name: label, renderer: renderer.select.value, stopOnEntry: stop.input.checked
      });
      profiles.select(projectId, profile.id);
      onApply(profile);
    } catch (error) { status.textContent = error.message; }
  });
  load();
  return form;
}
