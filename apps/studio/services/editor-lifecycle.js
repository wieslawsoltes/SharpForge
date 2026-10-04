import { studioDocumentOwner, throwStudioFailures } from './document-owner.js';

/** Include the full-workspace lifetime when binding optional features to a native or browser identity. */
export function studioWorkspaceIdentity(state, identity) {
  return `${identity}:${state.workspaceEpoch ?? 0}`;
}

/** Retire old editor instances before notifying source consumers; full replacements also advance workspace identity. */
export function resetStudioEditors(host, { newWorkspace = true } = {}) {
  const owner = studioDocumentOwner(host);
  if (owner) return resetOwnedStudioEditors(host, owner);
  const { state, editors, docking, navigation } = host;
  const retired = [...editors.keys()];
  if (newWorkspace) state.workspaceEpoch = (state.workspaceEpoch ?? 0) + 1;
  navigation.clear();
  host.navigationButtons();
  for (const id of [...docking.host.popouts.keys()]) {
    if (id.startsWith('source:')) docking.host.returnPopout(id);
  }
  for (const instance of editors.values()) instance.dispose();
  editors.clear();
  host.clearActiveEditor();
  for (const id of [...docking.content.keys()]) {
    if (!id.startsWith('source:')) continue;
    docking.host.contents.delete(id);
    docking.content.delete(id);
  }
  host.annotations.reset();
  for (const uri of retired) host.documentEvents.publish(uri, undefined);
  host.documentEvents.reset();
}

function resetOwnedStudioEditors(host, owner) {
  const { docking, documentEvents } = host;
  const maps = [owner.views, owner.activeViews, docking.host?.popouts, docking.host?.contents, docking.content];
  const methods = [owner.resetEditors, docking.tabs?.metadata, docking.host?.returnPopout,
    host.navigationButtons, host.clearActiveEditor, host.annotations?.reset];
  if (host.navigation != null) methods.push(host.navigation.clear);
  if (maps.some(map => !(map instanceof Map)) || methods.some(method => typeof method !== 'function') ||
      documentEvents && (typeof documentEvents.publish !== 'function' || typeof documentEvents.reset !== 'function')) {
    throw new TypeError('The native Studio owner cannot retire its document views');
  }
  const retired = new Set([...owner.views.keys(), ...owner.editors.keys()]);
  const panelIds = new Set([...docking.content.keys(), ...docking.host.contents.keys(), ...docking.host.popouts.keys()]);
  const panels = [...panelIds].filter(id => docking.tabs.metadata(id));
  const popouts = panels.filter(id => docking.host.popouts.has(id));
  const effects = [() => host.navigation?.clear(), () => host.navigationButtons(),
    ...popouts.map(id => () => docking.host.returnPopout(id)), () => owner.resetEditors(), () => host.clearActiveEditor(),
    ...panels.map(id => () => { docking.host.contents.delete(id); docking.content.delete(id); }),
    () => host.annotations.reset()];
  if (documentEvents) {
    for (const uri of retired) effects.push(() => documentEvents.publish(uri, undefined));
    effects.push(() => documentEvents.reset());
  }
  const failures = [];
  // The loader already committed native workspace identity. View cleanup must not advance it again.
  for (const effect of effects) {
    try { effect(); } catch (error) { failures.push(error); }
  }
  throwStudioFailures(failures, 'Studio document views retired, but a cleanup callback failed');
}
