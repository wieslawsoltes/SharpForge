import { WindowNavigator } from '../navigation/navigator.js';
import { showWindowsDialog } from './windows-dialog.js';
import { windowCommands } from './window-commands.js';

/** Window commands, keyboard routing and dialogs consume the same document/layout services as pointer interactions. */
export class WindowManagement {
  constructor({ host, tabs, layouts, navigation, onError = () => {} } = {}) {
    this.host = host;
    this.tabs = tabs;
    this.layouts = layouts;
    this.navigation = navigation;
    this.onError = onError;
    this.navigator = new WindowNavigator({ host, tabs });
    this.controller = new AbortController();
    this.keyHandler = event => this.handleKeyDown(event);
    host.element.ownerDocument.addEventListener('keydown', this.keyHandler, { capture: true, signal: this.controller.signal });
  }

  get active() { return this.host.layout.state.activePanel; }
  documentActive() { return Boolean(this.tabs.metadata(this.active)); }
  descriptors() { return windowCommands(this); }
  showWindows() { return showWindowsDialog(this, this.host.element.ownerDocument); }
  autoHideAll() { return this.host.layout.autoHideAll(); }
  float() { return this.active ? this.host.layout.float(this.active) : false; }
  dock() { return this.active ? this.host.layout.pin(this.active) : false; }
  newWindow() { return this.documentActive() ? this.tabs.newView(this.active) : false; }
  closeAllDocuments() { return this.tabs.closeMany(this.tabs.list()); }

  fullscreen() {
    const enabled = !this.host.fullscreen;
    if (enabled) {
      this.previousMaximized = this.host.maximizedGroup;
      const group = this.host.layout.groups().find(item => item.kind === 'document');
      this.host.maximizedGroup = group?.id ?? null;
    } else this.host.maximizedGroup = this.previousMaximized ?? null;
    this.host.fullscreen = enabled;
    this.host.render();
    return enabled;
  }

  keyboardWindowMenu() {
    if (!this.active) return false;
    const tab = this.host.element.querySelector(`[data-dock-tab="${this.host.escape(this.active)}"]`);
    const bounds = tab?.getBoundingClientRect() ?? this.host.element.getBoundingClientRect();
    this.host.menu(this.active, bounds.left, bounds.bottom);
    return true;
  }

  handleKeyDown(event) {
    if (event.defaultPrevented || this.navigator.overlay) return false;
    const invoke = callback => {
      event.preventDefault();
      event.stopPropagation();
      this.host.attempt(callback);
      return true;
    };
    if (event.ctrlKey && !event.altKey && event.key === 'Tab') {
      return invoke(() => this.navigator.open({ reverse: event.shiftKey, document: event.target.ownerDocument ?? this.host.element.ownerDocument }));
    }
    if (event.altKey && !event.ctrlKey && event.key === 'F7') {
      return invoke(() => this.navigator.open({ toolsOnly: true, reverse: event.shiftKey,
        document: event.target.ownerDocument ?? this.host.element.ownerDocument }));
    }
    if (event.ctrlKey && event.altKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
      return invoke(() => this.layouts.applySlot(Number(event.key)));
    }
    if (event.shiftKey && event.altKey && event.key === 'Enter') return invoke(() => this.fullscreen());
    if (event.shiftKey && !event.ctrlKey && !event.altKey && event.key === 'Escape'
        && this.active && this.host.layout.require(this.active).kind === 'tool') return invoke(() => this.host.closePanel(this.active));
    if (event.altKey && !event.ctrlKey && ['-', 'Subtract'].includes(event.key)) return invoke(() => this.keyboardWindowMenu());
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 't') return invoke(() => this.tabs.reopenClosed());
    if (event.altKey && !event.ctrlKey && event.key === 'ArrowLeft') return invoke(() => this.navigation.back());
    if (event.altKey && !event.ctrlKey && event.key === 'ArrowRight') return invoke(() => this.navigation.forward());
    return false;
  }

  attachPopout(document) {
    document.addEventListener('keydown', this.keyHandler, { capture: true, signal: this.controller.signal });
  }

  dispose() { this.controller.abort(); this.navigator.dispose(); }
}
