import { bindTouchTab, resizeSplit } from './pointer.js';

function activateTab(host, id) {
  host.layout.activate(id);
  host.onActivate(id);
}

function createTab(host, group, id) {
  const panel = host.layout.require(id);
  const state = host.layout.state.tabState[id] ?? {};
  const tab = host.el('button', 'sf-dock-tab', panel.title);
  tab.type = 'button';
  tab.dataset.dockTab = id;
  tab.dataset.panel = panel.kind === 'tool' ? id : '';
  tab.title = panel.description ?? panel.title;
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', String(group.active === id));
  tab.setAttribute('aria-controls', host.contentId(id));
  tab.setAttribute('aria-label', `${panel.title}${state.pinned ? ', pinned' : ''}${state.preview ? ', preview' : ''}${panel.dirty ? ', modified' : ''}`);
  tab.tabIndex = group.active === id ? 0 : -1;
  tab.draggable = true;
  tab.classList.toggle('selected', group.active === id);
  tab.classList.toggle('pinned', Boolean(state.pinned));
  tab.classList.toggle('preview', Boolean(state.preview));
  tab.classList.toggle('dirty', Boolean(panel.dirty));
  tab.onclick = () => activateTab(host, id);
  tab.ondblclick = () => {
    if (panel.kind === 'document' && host.onTabDoubleClick) host.attempt(() => host.onTabDoubleClick(id));
    else host.attempt(() => host.toggleFloat(id));
  };
  tab.oncontextmenu = event => { event.preventDefault(); host.menu(id, event.clientX, event.clientY); };
  tab.onauxclick = event => {
    if (event.button === 1 && panel.closable) { event.preventDefault(); host.attempt(() => host.closePanel(id)); }
  };
  tab.onkeydown = event => tabKeyDown(host, group, id, event, tab);
  tab.ondragstart = event => {
    host.dragPanel = id;
    event.dataTransfer.setData('application/x-sharpforge-panel', id);
    event.dataTransfer.effectAllowed = 'move';
    host.element.classList.add('sf-dock-dragging');
  };
  tab.ondragend = () => host.clearDrag();
  tab.ondragover = event => {
    if (!host.acceptsDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    tab.classList.add('drop-before');
  };
  tab.ondragleave = () => tab.classList.remove('drop-before');
  tab.ondrop = event => {
    host.readDrag(event);
    if (!host.dragPanel) return;
    event.preventDefault();
    event.stopPropagation();
    host.attempt(() => host.layout.dock(host.dragPanel, group.id, 'center', group.panels.indexOf(id)));
    host.clearDrag();
  };
  bindTouchTab(host, tab, id);
  return tab;
}

function tabKeyDown(host, group, id, event, tab) {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const index = group.panels.indexOf(id);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? group.panels.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + group.panels.length) % group.panels.length;
    const target = group.panels[next];
    if (event.altKey && event.shiftKey) host.layout.dock(id, group.id, 'center', next);
    else activateTab(host, target);
    host.focusTab(event.altKey && event.shiftKey ? id : target);
  } else if (event.key === 'Delete' && host.layout.require(id).closable) {
    event.preventDefault();
    host.attempt(() => host.closePanel(id));
  } else if (event.shiftKey && event.key === 'F10') {
    event.preventDefault();
    const bounds = tab.getBoundingClientRect();
    host.menu(id, bounds.left, bounds.bottom);
  }
}

export function createGroupView(host, group) {
  const element = host.el('section', `sf-dock-group ${group.kind}`);
  element.dataset.dockGroup = group.id;
  const bar = host.el('div', 'sf-dock-bar');
  const tabs = host.el('div', 'sf-dock-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', group.kind === 'document' ? 'Document group' : 'Tool window group');
  const previous = host.button('‹', 'Scroll tabs left', () => tabs.scrollBy({ left: -150, behavior: 'auto' }));
  const next = host.button('›', 'Scroll tabs right', () => tabs.scrollBy({ left: 150, behavior: 'auto' }));
  previous.classList.add('sf-dock-scroll');
  next.classList.add('sf-dock-scroll');
  for (const id of group.panels) tabs.append(createTab(host, group, id));
  const overflow = host.button('▾', 'List all open tabs', () => {
    const bounds = bar.getBoundingClientRect();
    host.showMenu(group.panels.map(id => ({ id: `activate:${id}`, title: host.layout.require(id).description ?? host.layout.require(id).title,
      execute: () => { activateTab(host, id); host.focusTab(id); } })), bounds.right - 260, bounds.bottom, { label: 'All open tabs' });
  });
  overflow.classList.add('sf-dock-overflow');
  bar.append(previous, tabs, next, overflow);
  if (group.active) {
    const id = group.active;
    bar.append(host.button('⌄', `Window actions: ${host.layout.require(id).title}`, () => {
      const bounds = bar.getBoundingClientRect();
      host.menu(id, bounds.right - 260, bounds.bottom);
    }));
    if (host.layout.require(id).closable) bar.append(host.button('×', `Close ${host.layout.require(id).title}`, () => host.closePanel(id)));
  }
  element.append(bar);
  const body = host.el('div', 'sf-dock-body');
  for (const id of group.panels) {
    if (host.popouts.has(id)) {
      if (group.active === id) {
        const placeholder = host.el('div', 'sf-dock-empty', 'This panel is in a separate browser window.');
        placeholder.append(host.button('Activate window', 'Focus separate window', () => host.focusPanel(id)),
          host.button('Return here', 'Return panel to workspace', () => host.returnPopout(id)));
        body.append(placeholder);
      }
      continue;
    }
    const content = host.content(id);
    content.hidden = group.active !== id;
    body.append(content);
  }
  if (!group.panels.length) body.append(host.el('div', 'sf-dock-empty', 'Drop a document or tool here'));
  element.append(body);
  element.ondragover = event => {
    if (!host.acceptsDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    host.guides.update(element, event);
  };
  element.ondrop = event => {
    host.readDrag(event);
    if (!host.dragPanel && !host.dragNode) return;
    event.preventDefault();
    event.stopPropagation();
    const target = host.guides.update(element, event);
    if (target) host.dropDrag(target, group.id);
    else host.clearDrag();
  };
  return element;
}

export function createNodeView(host, node) {
  if (node.type === 'group') return createGroupView(host, node);
  const split = host.el('div', `sf-dock-split ${node.axis}`);
  split.dataset.splitId = node.id;
  const first = host.el('div', 'sf-dock-branch');
  const second = host.el('div', 'sf-dock-branch');
  first.style.flex = `${node.ratio} 1 0`;
  second.style.flex = `${1 - node.ratio} 1 0`;
  first.append(createNodeView(host, node.first));
  second.append(createNodeView(host, node.second));
  const divider = host.el('div', 'sf-dock-divider');
  divider.tabIndex = 0;
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-label', 'Resize docked groups');
  divider.setAttribute('aria-orientation', node.axis === 'horizontal' ? 'vertical' : 'horizontal');
  divider.setAttribute('aria-valuemin', '5');
  divider.setAttribute('aria-valuemax', '95');
  divider.setAttribute('aria-valuenow', String(Math.round(node.ratio * 100)));
  divider.onkeydown = event => {
    const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? .03 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -.03 : 0;
    if (delta) { event.preventDefault(); host.layout.resize(node.id, node.ratio + delta); }
  };
  divider.onpointerdown = event => resizeSplit(host, event, divider, split, node, first, second);
  split.append(first, divider, second);
  return split;
}
