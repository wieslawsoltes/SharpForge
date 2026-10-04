/** Model owners release all views, including views which are not the primary editor for their URI. */
export function attachNativeViews(fixture, options = {}) {
  const { host, owner, effects, counters } = fixture;
  const views = [];
  for (const viewId of ['primary', 'secondary']) {
    const editor = { model: owner.models.get('first.cs'), disposed: false,
      dispose() { this.disposed = true; effects.push(`dispose:${viewId}`); } };
    views.push(editor);
    const record = { editor, element: { viewId } };
    if (!owner.views.has('first.cs')) owner.views.set('first.cs', new Map());
    owner.views.get('first.cs').set(viewId, record);
    if (viewId === 'primary') owner.editors.set('first.cs', editor);
  }
  owner.activeViews.set('first.cs', 'secondary');
  owner.resetEditors = () => {
    counters.resets++;
    for (const editor of views) editor.dispose();
    owner.views.clear();
    owner.editors.clear();
    owner.activeViews.clear();
    if (Object.hasOwn(options, 'resetError')) throw options.resetError;
  };
  const primary = 'source:first.cs';
  const secondary = 'document-view:2:first.cs';
  host.docking.content = new Map([[primary, {}], [secondary, {}], ['git', {}]]);
  host.docking.tabs = { metadata: id => id === primary || id === secondary ? { uri: 'first.cs' } : null };
  host.docking.host = {
    contents: new Map(host.docking.content), popouts: new Map([[secondary, {}], ['git', {}]]),
    returnPopout(id) { effects.push(`return:${id}`); this.popouts.delete(id); }
  };
  host.navigation = { clear: () => effects.push('navigation') };
  host.navigationButtons = () => effects.push('buttons');
  host.clearActiveEditor = () => effects.push('active');
  host.annotations.set('review', 'first.cs', [{ message: 'Old review', start: 0, length: 1 }]);
  return views;
}
