import {ResourceScope} from './resource-scope.js';

/** Root resource subscriptions share the host's explicit environment and follow the scope lifetime. */
export class EnvironmentResourceScope extends ResourceScope {
  constructor({resources, environment, theme} = {}) {
    super({resources});
    this.environment = environment;
    if (theme) this.setSystemTheme(theme.dark ? 'Dark' : 'Light', theme.highContrast);
    if (environment) this.updateEnvironment();
    this.subscribeEnvironment();
  }
  updateEnvironment() {
    const environment = this.environment;
    this.resources.setSystemPalette?.(environment.SystemColors ?? {});
    this.setSystemTheme(environment.DarkTheme ? 'Dark' : 'Light', environment.HighContrast);
  }
  subscribeEnvironment() {
    this.unsubscribeEnvironment?.();
    this.unsubscribeEnvironment = this.environment?.subscribe(change => {
      if (change.changed.some(name => ['DarkTheme', 'HighContrast', 'SystemColors'].includes(name))) this.updateEnvironment();
    });
  }
  restore(snapshot) {
    super.restore(snapshot);
    if (!this.disposed) this.subscribeEnvironment();
  }
  dispose() {
    this.unsubscribeEnvironment?.();
    this.unsubscribeEnvironment = null;
    super.dispose();
  }
}
