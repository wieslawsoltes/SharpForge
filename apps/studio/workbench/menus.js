import {mergeMenuContributions} from './menu-contributions.js';
import {button, element, runAction} from './ui.js';

export const workbenchMenus = Object.freeze([
  {id: 'file', title: 'File', mnemonic: 'f', commands: ['newProject', 'open', 'openFolder', 'save', 'saveDisk',
    'workbench.start', 'workbench.recent', 'workbench.settingsProfile']},
  {id: 'edit', title: 'Edit', mnemonic: 'e', commands: ['undo', 'redo', 'find', 'replace', 'findFiles',
    'workbench.replaceFiles', 'definition', 'references', 'rename', 'workbench.goToAll']},
  {id: 'view', title: 'View', mnemonic: 'v', commands: ['commands', 'tool:solution', 'tool:problems', 'tool:output',
    'tool:task-list', 'tool:class-view', 'tool:object-browser', 'tool:properties', 'tool:toolbox',
    'tool:outline', 'tool:bookmarks', 'tool:calls', 'tool:code-definition', 'tool:references', 'tool:command-window', 'workbench.toolbars']},
  {id: 'project', title: 'Project', mnemonic: 'p', commands: ['projectProperties', 'workbench.configuration']},
  {id: 'build', title: 'Build', mnemonic: 'b', commands: ['build', 'nativeMSBuild', 'nativeEvaluate', 'nativeCancel']},
  {id: 'debug', title: 'Debug', mnemonic: 'd', commands: ['debug', 'run', 'stop', 'pause', 'next', 'stepIn', 'stepOut',
    'toggleBreakpoint', 'removeBreakpoints', 'tool:diagnostics']},
  {id: 'test', title: 'Test', mnemonic: 't', commands: ['tool:test-explorer', 'workbench.tests.run', 'workbench.tests.failed']},
  {id: 'analyze', title: 'Analyze', mnemonic: 'a', commands: ['tool:task-list', 'tool:calls', 'tool:diagnostics', 'workbench.performance']},
  {id: 'tools', title: 'Tools', mnemonic: 'o', commands: ['workbench.options', 'workbench.settingsProfile', 'workbench.toolbars',
    'tool:background-tasks', 'tool:notifications', 'workbench.commandWindow']},
  {id: 'extensions', title: 'Extensions', mnemonic: 'x', commands: ['extensions', 'generatedSources']},
  {id: 'window', title: 'Window', mnemonic: 'w', commands: ['window.saveLayout', 'window.manageLayouts', 'window.resetLayout',
    'window.windows', 'window.autoHideAll', 'window.float', 'window.dock', 'window.newWindow', 'window.fullscreen', 'window.closeAllDocuments']},
  {id: 'help', title: 'Help', mnemonic: 'h', commands: ['examples', 'shortcuts', 'architecture', 'profile', 'about']}
]);

/** Menus resolve fresh command state and shortcut labels at opening time. */
export function menuCommands(menu, registry, keybindings) {
  return menu.commands.map(id => registry.describe(id)).filter(Boolean).map(command => ({
    ...command,
    shortcut: keybindings?.list().find(binding => binding.command === command.id && !binding.removed)?.keys ?? command.shortcut ?? ''
  }));
}

export function mountMenuBar(host, {registry, menus = workbenchMenus, menuContributions = [], keybindings, execute, onError}) {
  menus = mergeMenuContributions(menus, menuContributions);
  const document = host.ownerDocument;
  const controller = new AbortController();
  const bar = element(document, 'nav', {className: 'wb-menubar', role: 'menubar', 'aria-label': 'Main menu'});
  let openIndex = -1;
  let popup;
  let restoreFocus;
  const buttons = [];
  const close = (restore = true) => {
    popup?.remove();
    popup = null;
    for (const item of buttons) item.setAttribute('aria-expanded', 'false');
    openIndex = -1;
    if (restore) restoreFocus?.focus();
  };
  const open = index => {
    close(false);
    openIndex = (index + menus.length) % menus.length;
    const top = buttons[openIndex];
    top.setAttribute('aria-expanded', 'true');
    popup = element(document, 'div', {className: 'wb-menu-popup', role: 'menu', 'aria-label': menus[openIndex].title});
    for (const command of menuCommands(menus[openIndex], registry, keybindings)) {
      const row = button(document, '', runAction(async () => {
        close(false);
        await execute(command.id);
      }, onError), {role: command.checked === undefined ? 'menuitem' : 'menuitemcheckbox',
        'aria-disabled': !command.enabled, 'aria-checked': command.checked, tabIndex: -1});
      row.disabled = !command.enabled;
      row.append(element(document, 'span', {text: command.label}), element(document, 'kbd', {
        text: Array.isArray(command.shortcut) ? command.shortcut.join(' ') : command.shortcut
      }));
      popup.append(row);
    }
    bar.append(popup);
    const rect = top.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    popup.style.left = Math.max(0, Math.min(rect.left - barRect.left, bar.clientWidth - 260)) + 'px';
    popup.querySelector('button:not(:disabled)')?.focus();
  };
  for (const [index, menu] of menus.entries()) {
    const top = button(document, menu.title, () => openIndex === index ? close() : open(index), {
      role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false', tabIndex: index ? -1 : 0
    });
    buttons.push(top);
    bar.append(top);
  }
  bar.addEventListener('keydown', event => {
    const rows = popup ? [...popup.querySelectorAll('button:not(:disabled)')] : [];
    const current = rows.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      open((openIndex >= 0 ? openIndex : buttons.indexOf(document.activeElement)) + (event.key === 'ArrowRight' ? 1 : -1));
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!popup) open(Math.max(0, buttons.indexOf(document.activeElement)));
      else rows[(current + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      (event.key === 'Home' ? rows[0] : rows.at(-1))?.focus();
    } else if (event.key === 'Tab') close(false);
  }, {signal: controller.signal});
  document.addEventListener('keydown', event => {
    if (document.activeElement?.closest('[aria-modal="true"]')) return;
    if (event.key === 'Alt' && !event.ctrlKey && !event.metaKey) {
      if (bar.contains(document.activeElement)) { event.preventDefault(); close(); return; }
      restoreFocus = document.activeElement;
      buttons[0]?.focus();
      event.preventDefault();
    } else if (event.altKey && !event.ctrlKey && !event.metaKey) {
      const index = menus.findIndex(menu => menu.mnemonic === event.key.toLowerCase());
      if (index >= 0) {
        if (!bar.contains(document.activeElement)) restoreFocus = document.activeElement;
        open(index);
        event.preventDefault();
      }
    }
  }, {signal: controller.signal});
  document.addEventListener('pointerdown', event => { if (!bar.contains(event.target)) close(false); }, {signal: controller.signal});
  host.append(bar);
  return {open, close, dispose: () => { close(false); controller.abort(); bar.remove(); }};
}
