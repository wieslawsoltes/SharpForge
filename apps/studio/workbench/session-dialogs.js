import { createStartupDialog } from './startup-dialog.js';
import { createLaunchProfileDialog } from './launch-profile-dialog.js';

/** Session configuration dialogs restore focus and release their DOM when closed. */
export function createSessionDialogs({ document, services }) {
  const dialogs = new Set();
  const open = (label, content) => {
    const previous = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', label);
    const close = () => dialog.close();
    dialog.append(content(close));
    dialog.addEventListener('close', () => {
      dialogs.delete(dialog);
      dialog.remove();
      if (previous?.isConnected) previous.focus();
    }, { once: true });
    document.body.append(dialog);
    dialogs.add(dialog);
    dialog.showModal();
    return dialog;
  };
  return {
    configure: () => open('Set Startup Projects', close => createStartupDialog(document, services.startup, {
      profiles: services.profiles, onApply: close, onCancel: close
    })),
    configureProfiles: () => {
      const projectId = services.startup.entries[0]?.projectId ?? services.builds.activeId;
      if (!projectId) throw new Error('Open a project before configuring launch profiles');
      return open('Launch Profiles', close => createLaunchProfileDialog(document, {
        profiles: services.profiles, projectId, onCancel: close,
        onApply: profile => {
          services.startup.configure({ entries: services.startup.entries.map(entry =>
            entry.projectId === projectId ? { ...entry, profile: profile.id } : entry) });
          close();
        }
      }));
    },
    dispose() { for (const dialog of dialogs) dialog.close(); }
  };
}
