/** Registration descriptors consumed by the workbench command router and Window menu. */
export function windowCommands(windows) {
  const command = (id, title, execute, enabled = () => true, shortcut = null) => ({ id, title, execute, enabled, shortcut, category: 'Window' });
  const active = () => Boolean(windows.active);
  const document = () => windows.documentActive();
  const commands = [
    command('window.saveLayout', 'Save Window Layout', () => windows.layouts.saveDialog()),
    command('window.manageLayouts', 'Manage Window Layouts', () => windows.layouts.manageDialog()),
    command('window.resetLayout', 'Reset Window Layout', () => windows.layouts.reset()),
    command('window.windows', 'Windows', () => windows.showWindows()),
    command('window.autoHideAll', 'Auto Hide All', () => windows.autoHideAll()),
    command('window.float', 'Float', () => windows.float(), active),
    command('window.dock', 'Dock', () => windows.dock(), active),
    command('window.newWindow', 'New Window', () => windows.newWindow(), document),
    command('window.fullscreen', 'Full Screen', () => windows.fullscreen(), () => true, 'Shift+Alt+Enter'),
    command('window.maximizeDocument', 'Maximize Document Well', () => windows.host.maximize(), document),
    command('window.closeAllDocuments', 'Close All Documents', () => windows.closeAllDocuments(), () => windows.tabs.list().length > 0),
    command('window.closeTool', 'Close Tool Window', () => windows.host.closePanel(windows.active),
      () => active() && !document(), 'Shift+Esc'),
    command('window.menu', 'Window Actions', () => windows.keyboardWindowMenu(), active, 'Alt+-'),
    command('window.navigator', 'IDE Navigator', () => windows.navigator.open(), active, 'Ctrl+Tab'),
    command('window.toolNavigator', 'Tool Window Navigator', () => windows.navigator.open({ toolsOnly: true }), active, 'Alt+F7'),
    command('document.reopen', 'Reopen Closed Tab', () => windows.tabs.reopenClosed(), () => windows.tabs.closed.length > 0, 'Ctrl+Shift+T'),
    command('document.saveAll', 'Save All', () => windows.tabs.saveAll(), () => windows.tabs.list().length > 0, 'Ctrl+Shift+S'),
    command('navigate.backward', 'Navigate Backward', () => windows.navigation.back(), () => windows.navigation.history.canBack, 'Alt+Left'),
    command('navigate.forward', 'Navigate Forward', () => windows.navigation.forward(), () => windows.navigation.history.canForward, 'Alt+Right')
  ];
  for (let index = 1; index <= 9; index++) {
    commands.push(command(`window.applyLayout${index}`, `Apply Window Layout ${index}`, () => windows.layouts.applySlot(index),
      () => windows.layouts.entries.length >= index, `Ctrl+Alt+${index}`));
  }
  return commands;
}
