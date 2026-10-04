import {button, checkbox, element} from './ui.js';
import {settingsDefaults} from './settings-store.js';
import {showFirstRun} from './first-run.js';

export function showSettingsProfile({dialogs, settings, download, onError}) {
  const selected = new Set(Object.keys(settingsDefaults));
  let preview;
  return dialogs.open({
    title: 'Import and Export Settings',
    render(host) {
      const document = host.ownerDocument;
      const list = element(document, 'div', {className: 'wb-settings-categories'});
      for (const category of Object.keys(settingsDefaults)) {
        list.append(checkbox(document, category, true, checked => checked ? selected.add(category) : selected.delete(category)));
      }
      const previewHost = element(document, 'pre', {className: 'wb-source', 'aria-label': 'Import changes'});
      const file = element(document, 'input', {type: 'file', accept: '.json,application/json', 'aria-label': 'Settings profile to import'});
      file.addEventListener('change', async () => {
        try {
          if (!file.files[0]) return;
          if (file.files[0].size > 2_000_000) throw new Error('Settings file exceeds 2 MB');
          preview = settings.previewImport(await file.files[0].text());
          previewHost.textContent = preview.conflicts.map(change =>
            `${change.category}.${change.key}: ${JSON.stringify(change.current)} → ${JSON.stringify(change.incoming)}`).join('\n');
        } catch (error) { preview = null; previewHost.textContent = error.message; onError?.(error); }
      });
      host.append(element(document, 'p', {text: 'Profiles contain display and workflow preferences. Runtime grants are excluded.'}));
      host.append(list, button(document, 'Export selected categories', () =>
        download('SharpForge.settings.json', settings.export([...selected]), 'application/json')), file, previewHost);
    },
    actions: [{label: 'Import previewed changes', run: () => {
      if (!preview) throw new Error('Choose a valid settings profile first');
      const values = Object.fromEntries(Object.entries(preview.settings).filter(([category]) => selected.has(category)));
      settings.apply(values, {clearWorkspaceOverrides: true});
      return true;
    }}, {label: 'Choose development environment…', run: () => {
      showFirstRun({dialogs, settings, force: true});
      return true;
    }}, {label: 'Reset selected categories', run: () => {
      settings.reset([...selected]);
      return true;
    }}]
  });
}
