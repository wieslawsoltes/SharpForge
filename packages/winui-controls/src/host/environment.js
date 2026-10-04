import { EnvironmentState, environmentLayoutProperties } from '../layout/environment-state.js';
import { BrowserEnvironmentObserver } from '../layout/environment-browser.js';
import { TextScalePolicy } from '../layout/text-scale.js';
import { EnvironmentAppearance } from './environment-appearance.js';

/** Install one observer and share its policy with layout, control families, resource scopes and drawing. */
export function initializeHostEnvironment(host) {
  const services = host.services;
  host.environmentAppearance = new EnvironmentAppearance(host);
  services.environment ??= new EnvironmentState();
  services.textScale ??= new TextScalePolicy({ factor: services.environment.TextScaleFactor });
  const onChanged = change => {
    const environment = services.environment;
    host.environmentAppearance.update(environment);
    host.measureProvider.setTextScaleFactor?.(environment.TextScaleFactor);
    host.measureProvider.invalidate?.();
    host.layoutEngine.setScale(environment.RasterizationScale);
    for (const id of host.layoutEngine.states.keys()) host.layoutEngine.invalidate(id);
    if (change.changed.includes('AnimationsEnabled') && !environment.AnimationsEnabled) {
      services.themeTransitions?.dispose();
      services.implicitTransitions?.dispose();
      services.connectedAnimations?.cancelNavigation();
    }
    services.environmentChanged?.(change);
    host.options.onEnvironmentSnapshot?.(environment.snapshot());
    host.modelDirty = true;
    host.schedule();
  };
  const observer = new BrowserEnvironmentObserver(host.root, { state: services.environment, textScale: services.textScale,
    rootId: host.rootKey, onChanged, onInputPane: (event, payload) => host.options.onInputPane?.(event, payload) });
  services.systemColors ??= name => observer.systemColor(name);
  services.inputPane ??= observer;
  host.layoutEngine.resolveProperties = node => environmentLayoutProperties(node, services.environment);
  host.environment = observer;
  host.options.onEnvironmentSnapshot?.(services.environment.snapshot());
}

export function disposeHostEnvironment(host) {
  host.environment.dispose();
  host.environmentAppearance.dispose();
  if (host.services.inputPane === host.environment) delete host.services.inputPane;
}

export function refreshHostEnvironment(host) {
  const window = host.nodes.get(host.windows[0]);
  host.environment?.refresh({ contentId: window?.properties.Content?.$ref ?? null });
}
