/** Browser behavior coverage; the clipboard provider is explicitly injected, never presented as OS clipboard evidence. */
async function runA16FamilyCommandFixture() {
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  const node = (id, type, properties = {}, collections = {}, events = []) => ({ id,
    type: 'Microsoft.UI.Xaml.Controls.' + type, properties: { IsEnabled: true, ...properties }, collections, events });
  const ref = id => ({ $ref: id });
  const key = (element, name) => element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  const scene = { version: 1, windows: ['command-window'], nodes: [
    { id: 'command-window', type: 'Microsoft.UI.Xaml.Window', properties: { Content: ref('command-root') }, collections: {}, events: [] },
    node('command-root', 'StackPanel', { Width: 360, Height: 500 }, { Children: [ref('bar'), ref('edit'), ref('commands')] }),
    node('bar', 'MenuBar', { Width: 320, Height: 32 }, { Items: [ref('file'), ref('edit-menu'), ref('view')] }),
    node('file', 'MenuBarItem', { Title: 'File' }, { Items: [ref('nested')] }),
    node('edit-menu', 'MenuBarItem', { Title: 'Edit' }, { Items: [ref('edit-action')] }),
    node('view', 'MenuBarItem', { Title: 'View' }, { Items: [ref('view-action')] }),
    node('edit-action', 'MenuFlyoutItem', { Text: 'Edit action' }),
    node('view-action', 'MenuFlyoutItem', { Text: 'View action' }),
    node('nested', 'MenuFlyoutSubItem', { Text: 'Encoding' }, { Items: [ref('radio-a'), ref('radio-b')] }),
    node('radio-a', 'RadioMenuFlyoutItem', { Text: 'UTF-8', IsChecked: true, GroupName: 'encoding' }),
    node('radio-b', 'RadioMenuFlyoutItem', { Text: 'UTF-16', IsChecked: false, GroupName: 'encoding' }),
    node('edit', 'TextBox', { Text: 'alpha beta', Width: 300, Height: 48, ContextFlyout: ref('text-flyout') }),
    node('text-flyout', 'TextCommandBarFlyout'),
    node('commands', 'CommandBar', { Width: 170, Height: 48 },
      { PrimaryCommands: [ref('a'), ref('b'), ref('c')], SecondaryCommands: [ref('secondary')] }),
    node('a', 'AppBarButton', { Label: 'Keep', Width: 60, DynamicOverflowOrder: 2 }),
    node('b', 'AppBarButton', { Label: 'First', Width: 60, DynamicOverflowOrder: 1 }),
    node('c', 'AppBarToggleButton', { Label: 'Together', Width: 60, DynamicOverflowOrder: 1 }),
    node('secondary', 'AppBarButton', { Label: 'Settings', Width: 90 })
  ] };
  await a16.mount(scene, { key: 'commands', width: 380, height: 520 });
  const record = a16.records.get('commands'), host = record.host;
  const until = async (predicate, message) => {
    for (let attempt = 0; attempt < 90; attempt++) {
      if (predicate()) return;
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    throw new Error(message);
  };
  const editor = host.elements.get('edit').querySelector('[data-part="text-editor"]');
  editor.focus();
  key(editor, 'F10');
  require(document.activeElement === host.elements.get('file').firstElementChild, 'F10 did not activate the first menu');
  key(document.activeElement, 'ArrowRight');
  require(document.activeElement === host.elements.get('edit-menu').firstElementChild, 'MenuBar did not traverse right');
  key(document.activeElement, 'ArrowLeft');
  key(document.activeElement, 'ArrowDown');
  await host.settled();
  const nested = host.elements.get('nested');
  require(document.activeElement === nested.firstElementChild, 'Down did not enter the File menu');
  key(document.activeElement, 'ArrowRight');
  await host.settled();
  require(nested.open, 'Right did not open the nested submenu');
  require(host.elements.get('radio-a').getAttribute('role') === 'menuitemradio', 'Radio menu role is absent');
  host.elements.get('radio-b').click();
  await host.settled();
  require(!host.nodes.get('radio-a').properties.IsChecked && host.nodes.get('radio-b').properties.IsChecked,
    'Radio menu group was not exclusive');
  const geometry = host.layoutEngine.states.get('commands').data.commandLayout;
  require(geometry.primary.join() === 'a' && geometry.overflow.join() === 'b,c', 'DynamicOverflowOrder group did not move together');
  host.elements.get('commands').querySelector('summary').click();
  await host.settled();
  require(!host.elements.get('secondary').hidden, 'Overflow button did not reveal secondary commands');
  require(host.elements.get('secondary').getAttribute('role') === 'menuitem', 'Overflow command lacks its menu role');
  host.invoke('commands', 'Collapse', []);
  await host.settled();
  let copied = '';
  record.services.clipboard = { available: true,
    async setContent(data) { copied = data.get('Text'); return { ok: true }; },
    async getContent() {
      const { DataPackage } = await __sharpforgeTestImport('/packages/winui-controls/src/index.js');
      const data = new DataPackage(); data.setText('clipboard fixture'); return { ok: true, data };
    } };
  host.invoke('edit', 'SelectText', [0, 5]);
  editor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 50 }));
  await until(() => record.services.overlays?.entries.some(entry => entry.id === 'text-flyout'), 'Text context flyout did not open');
  await host.settled();
  const flyout = host.elements.get('text-flyout');
  const command = name => flyout.querySelector(`[data-text-command="${name}"]`);
  require(!command('Copy').disabled && !command('Cut').disabled && !command('Paste').disabled,
    'Editable selection produced incorrect text command enabled states');
  command('Copy').click();
  await until(() => !record.services.overlays.entries.length, 'Copy did not complete and close the text flyout');
  require(copied === 'alpha', 'Copy did not use the selected editor text');
  host.nodes.get('edit').properties.IsReadOnly = true;
  host.invalidate('edit');
  await host.settled();
  host.invoke('edit', 'SelectText', [0, 5]);
  editor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await until(() => record.services.overlays.entries.length > 0, 'Readonly context flyout did not open');
  require(!command('Copy').disabled && command('Cut').disabled && command('Paste').disabled,
    'Readonly text context commands did not retain copy while disabling edits');
  await host.invoke('text-flyout', 'Hide', []);
  let acknowledged = 0;
  host.options.onEventRequest = async (_id, name, payload) => {
    if (name === 'ContextRequested') { acknowledged++; return { ...payload, Handled: true }; }
    return payload;
  };
  editor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await until(() => acknowledged > 0, 'ContextRequested did not reach the acknowledged channel');
  await host.settled();
  require(!record.services.overlays.entries.length, 'Handled ContextRequested still opened a flyout');
  return { menuTraversal: 'passed', nestedSubmenu: 'passed', radioExclusivity: 'passed', dynamicOverflow: 'passed',
    textCommands: 'passed', handledContext: 'passed', clipboardBackend: 'injected-permission-granted-provider' };
}
