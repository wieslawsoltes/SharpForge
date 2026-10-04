import {element, field, select} from './ui.js';
import {EDITOR_KEYMAPS} from '@sharpforge/editor';

export function showFirstRun({dialogs, settings}) {
  if (settings.get('environment', 'firstRunComplete')) return null;
  let theme = settings.get('environment', 'theme');
  let keymap = settings.get('environment', 'keymap');
  return dialogs.open({title: 'Choose Your Development Environment', render(host) {
    const document = host.ownerDocument;
    host.append(element(document, 'p', {text: 'Choose a theme and keyboard scheme. You can change these in Tools → Options at any time.'}));
    host.append(field(document, 'Theme', select(document, 'Theme', ['dark', 'light', 'blue', 'high-contrast', 'system'], theme,
      value => { theme = value; })));
    host.append(field(document, 'Keyboard scheme', select(document, 'Keyboard scheme',
      EDITOR_KEYMAPS.map(item => ({value: item.id, label: item.label})), keymap, value => { keymap = value; })));
  }, actions: [{label: 'Start coding', run: () => {
    settings.apply({environment: {theme, keymap, firstRunComplete: true}});
    return true;
  }}]});
}
