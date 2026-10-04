import { defaultSessionSettings } from './workbench/session-settings.js';
import { createLegacyRuntimeSettings } from './workbench/session-runtime-bridge.js';
import { renderRuntimeSettings } from './workbench/session-runtime-view.js';

export const defaultRuntimeSettings = defaultSessionSettings;

/** User grants are memory-only and owned by the injected profile/application settings provider. */
export class RuntimeTools {
  constructor({ state, request, build, save, toast, settings }) {
    Object.assign(this, { state, request, build, save, toast });
    this.settingsProvider = settings ?? createLegacyRuntimeSettings({ state, save, request });
    this.el = null;
  }

  configure(patch = {}) { return this.settingsProvider.configure(patch); }
  settings() { return this.settingsProvider.settings(); }
  launchOptions(...args) { return this.settingsProvider.launchOptions(...args); }
  revoke() { return this.settingsProvider.revoke(); }

  renderTool(panel, element) {
    if (panel !== 'runtime-settings') return false;
    this.el = element;
    renderRuntimeSettings(this, element);
    return true;
  }

  update() {
    const target = this.el?.querySelector('#runtime-metrics');
    if (target) target.textContent = JSON.stringify(this.state.debug?.runtime ?? {}, null, 2);
  }

  async refresh() {
    const selected = this.settingsProvider.context?.().id;
    try {
      const value = await this.request('runtimeInfo');
      if (selected !== this.settingsProvider.context?.().id) return;
      const target = this.el?.querySelector('#runtime-metrics');
      if (target) target.textContent = JSON.stringify(value, null, 2);
    } catch (error) { this.toast(error.message, 'error'); }
  }
}
