async function installA16BrowserHarness() {
  const [{ WinUIHost }, controls] = await Promise.all([
    __sharpforgeTestImport('/packages/winui/src/index.js'), __sharpforgeTestImport('/packages/winui-controls/src/index.js')]);
  const stage = document.createElement('section');
  stage.id = 'a16-stage'; stage.setAttribute('aria-label', 'A16 control conformance');
  Object.assign(stage.style, { position: 'fixed', inset: '0', zIndex: '2147483000', background: 'Canvas', color: 'CanvasText',
    overflow: 'auto', padding: '12px', display: 'flex', gap: '12px' });
  document.body.append(stage);
  const records = new Map();
  const errors = [];
  function dispose() {
    for (const { app, host, services } of records.values()) {
      if (app) app.dispose();
      else { host.dispose(); services.dispose?.(); }
    }
    records.clear(); stage.replaceChildren(); errors.length = 0;
  }
  async function mount(scene, { key = 'main', backend = 'dom', privateValue, append = false, width = 520, height = 360 } = {}) {
    if (!append) dispose();
    const column = document.createElement('div');
    const before = document.createElement('button');
    before.textContent = 'Before ' + key; before.dataset.a16Before = key;
    const root = document.createElement('div'); root.dataset.a16Root = key;
    Object.assign(root.style, { position: 'relative', width: width + 'px', height: height + 'px', border: '0', overflow: 'hidden' });
    column.append(before, root); stage.append(column);
    const services = controls.createControlServices({ document, window });
    delete services.resources;
    const events = [], privateEdits = [], stateChanges = [];
    const host = new WinUIHost(root, { backend, rootId: 'a16-' + key, services,
      onError: error => errors.push({ key, message: String(error?.message ?? error) }),
      onEvent: (id, name, payload) => events.push({ id, name, payload: controls.serializeRoutedEvent(payload) }),
      onControlStateChanged: changes => stateChanges.push(...controls.validateControlStateChanges(changes)),
      onPrivateInput: (id, property, value) => privateEdits.push({ id, property, length: value.length }) });
    const record = { host, root, services, events, privateEdits, before, stateChanges };
    records.set(key, record);
    try {
      host.load(scene);
      if (privateValue != null) host.setPrivateValue(scene.nodes.find(node => node.type.endsWith('.PasswordBox')).id, 'Password', privateValue);
      await host.settled();
      if (errors.length) throw new Error(errors.map(value => value.message).join('\n'));
    } catch (error) { dispose(); throw error; }
    return describe(key);
  }
  function describe(key = 'main') {
    const record = records.get(key), { host, root } = record;
    const snapshot = host.automation.snapshot();
    return { snapshot, structural: controls.auditAutomationSnapshot(snapshot), dom: controls.auditAriaDom(root),
      elements: host.elements.size, errors: [...errors], focused: host.focusManager.focusedElement,
      controls: [...host.nodes].filter(([, node]) => node.type !== 'Microsoft.UI.Xaml.Window').map(([id]) => {
        const peer = host.automation.getPeer(id);
        return { id, focusable: peer?.IsKeyboardFocusable() ?? false, offscreen: peer?.IsOffscreen() ?? true };
      }) };
  }
  function geometry(id, key = 'main') {
    const { host } = records.get(key), element = host.elements.get(id);
    const bounds = element.getBoundingClientRect(), layout = host.getLayout(id);
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      layout: layout?.bounds, css: { border: getComputedStyle(element).borderTopColor, borderWidth: getComputedStyle(element).borderTopWidth,
        display: getComputedStyle(element).display } };
  }
  function textGeometry(id, key = 'main') {
    const { host } = records.get(key), element = host.elements.get(id);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode())) if (text.nodeValue === 'Hg') break;
    if (!text) throw new Error('Actual button text node was not retained');
    const range = document.createRange(); range.selectNodeContents(text);
    const r = range.getBoundingClientRect(), b = element.getBoundingClientRect();
    return { top: r.top - b.top, bottom: b.bottom - r.bottom, textHeight: r.height, height: b.height,
      difference: Math.abs((r.top - b.top) - (b.bottom - r.bottom)) };
  }
  function hostState(key = 'main') {
    const { host, events, privateEdits, stateChanges } = records.get(key);
    return { events, privateEdits, stateChanges, focused: host.focusManager.focusedElement,
      nodes: [...host.nodes.values()].map(node => ({ id: node.id, properties: node.properties })) };
  }
  function installDrag(key = 'main') {
    const { host, events } = records.get(key);
    host.eventRouter.addHandler('source', 'DragStarting', (_id, payload) => {
      payload.Data = { version: 1, values: [['Text', 'native browser drag']], requestedOperation: 1 }; payload.AllowedOperations = 1;
    });
    for (const event of ['DragEnter', 'DragOver', 'Drop']) host.eventRouter.addHandler('target', event, (_id, payload) => {
      payload.AcceptedOperation = 1;
      if (event === 'Drop') events.push({ id: 'target', name: 'ObservedDrop', payload: structuredClone(payload.DataView) });
    });
  }
  async function nativeDrop(key = 'main') {
    const { host } = records.get(key), source = host.elements.get('source'), target = host.elements.get('target-text');
    const transfer = new DataTransfer();
    const emit = (element, type) => {
      const bounds = element.getBoundingClientRect();
      element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer,
        clientX: bounds.x + 5, clientY: bounds.y + 5 }));
    };
    emit(source, 'dragstart'); emit(target, 'dragenter'); emit(target, 'dragover'); emit(target, 'drop'); emit(source, 'dragend');
    return { text: transfer.getData('text/plain'), dropEffect: transfer.dropEffect, state: hostState(key) };
  }
  async function fileDropPolicy(key = 'main') {
    const { host } = records.get(key);
    let reads = 0, granted = false, permissionCalls = 0;
    host.input.dragDrop.files.dispose();
    host.input.dragDrop.files = new controls.DropFileBroker({ policy: { authorize: async () => { permissionCalls++; return granted; } },
      readFiles: async files => { reads++; const text = await files[0].text(); if (text !== 'file contents') throw new Error('Wrong native file');
        return files.map(file => ({ id: 'authorized:file', name: file.name, contentType: file.type, size: file.size, lastModified: file.lastModified })); } });
    const files = [new File(['file contents'], 'note.txt', { type: 'text/plain', lastModified: 1000 })];
    const denied = host.input.dragDrop.files.capture(files);
    let rejection;
    try { await host.input.dragDrop.files.read(denied); } catch (error) { rejection = error.message; }
    const before = reads; granted = true;
    const token = host.input.dragDrop.files.capture(files), result = await host.input.dragDrop.files.read(token);
    return { rejection, before, reads, permissionCalls, result, sceneHasContents: JSON.stringify([...host.nodes.values()]).includes('file contents') };
  }
  globalThis.a16 = { stage, records, errors, mount, describe, geometry, textGeometry, hostState, dispose, installDrag, nativeDrop, fileDropPolicy };
}
