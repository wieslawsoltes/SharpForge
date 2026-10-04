/** Real browser focus, tooltip lifetime and cancellable accelerator coverage for the full A16 batch. */
async function runA16FamilyOverlayFixture() {
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  const ref = id => ({ $ref: id });
  const scene = { version: 1, windows: ['overlay-window'], nodes: [
    { id: 'overlay-window', type: 'Microsoft.UI.Xaml.Window', properties: { Content: ref('trigger') }, collections: {}, events: [] },
    { id: 'trigger', type: 'Microsoft.UI.Xaml.Controls.Button', properties: { Content: 'Show details', Width: 180, Height: 32,
      'ToolTipService.ToolTip': ref('tip'), IsEnabled: true }, collections: { KeyboardAccelerators: [ref('shortcut')] }, events: ['Click'] },
    { id: 'tip', type: 'Microsoft.UI.Xaml.Controls.ToolTip', properties: { Content: 'Details tooltip', Width: 160, Height: 32 },
      collections: {}, events: [] },
    { id: 'dialog', type: 'Microsoft.UI.Xaml.Controls.ContentDialog', properties: { Title: 'Modal fixture', Content: 'Dialog contents',
      CloseButtonText: 'Close', Width: 240, Height: 180 }, collections: {}, events: [] },
    { id: 'shortcut', type: 'Microsoft.UI.Xaml.Input.KeyboardAccelerator', properties: { Key: 75, Modifiers: 2, IsEnabled: true },
      collections: {}, events: ['Invoked'] }
  ] };
  await a16.mount(scene, { key: 'overlays', width: 360, height: 280 });
  const { host, services, events } = a16.records.get('overlays');
  const trigger = host.elements.get('trigger');
  const until = async (predicate, message) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (predicate()) return;
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    throw new Error(message);
  };
  trigger.setAttribute('aria-describedby', 'existing-description');
  trigger.focus();
  trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
  await until(() => services.overlays?.entries.some(entry => entry.id === 'tip'), 'Typed tooltip did not open after its delay');
  const tooltip = host.elements.get('tip');
  require(trigger.getAttribute('aria-describedby').split(/\s+/).includes(tooltip.id), 'Typed tooltip lacks described-by ownership');
  require(document.activeElement === trigger, 'Tooltip stole keyboard focus');
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await until(() => !services.overlays.entries.length, 'Escape did not dismiss the tooltip');
  require(trigger.getAttribute('aria-describedby') === 'existing-description', 'Tooltip dismissal removed an unrelated description');
  const shown = host.invoke('dialog', 'ShowAsync', []);
  let repeated;
  try { host.invoke('dialog', 'ShowAsync', []); } catch (error) { repeated = error.code; }
  require(repeated === 'SFUI1664', 'Concurrent ShowAsync did not fault');
  await host.invoke('dialog', 'Hide', []);
  require(await shown === 0, 'Dialog cancellation result was not None');
  let handled = true;
  let requests = 0;
  host.options.onEventRequest = async (id, name, payload) => {
    if (id === 'shortcut' && name === 'Invoked') {
      requests++;
      require(payload.Element.$ref === 'trigger' && !Object.hasOwn(payload, 'event'), 'Accelerator payload leaked a DOM event');
      return { ...payload, Handled: handled };
    }
    return payload;
  };
  const invoke = () => trigger.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
  const clicks = () => events.filter(value => value.id === 'trigger' && value.name === 'Click').length;
  const before = clicks();
  require(invoke() === false, 'Accelerator did not prevent the browser default while awaiting the handler');
  await until(() => requests === 1, 'Accelerator handler did not reach its request channel');
  await host.settled();
  require(clicks() === before, 'Handled accelerator still invoked the control');
  handled = false;
  invoke();
  await until(() => clicks() === before + 1, 'Unhandled accelerator did not invoke the control exactly once');
  require(!a16.errors.length, 'Overlay fixture produced host faults: ' + JSON.stringify(a16.errors));
  return { tooltipDescription: 'passed', tooltipFocus: 'passed', concurrentDialog: 'passed', acceleratorHandled: 'passed' };
}
