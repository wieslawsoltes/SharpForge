import { HostPermissionPolicy } from './capabilities.js';
import { ClipboardService, LauncherService } from '../app/data-transfer.js';
import { ResourceLoader } from '../app/resources.js';
import { ActivationService } from '../app/activation.js';
import { ApplicationSession, VisibilityLifecycle } from '../app/application.js';
import { ControlInteractionBindings } from '../commands/interactions.js';

/** Explicit dependencies let browser, worker and deterministic hosts share policy without global state. */
export function createControlServices(options = {}) {
  const permissions = options.permissions ?? new HostPermissionPolicy(options.permissionPolicy);
  const resources = options.resourceLoader ?? new ResourceLoader({ resources: options.resources,
    language: options.language, fallbackLanguage: options.fallbackLanguage });
  const application = options.application ?? new ApplicationSession({ resources, saveState: options.saveApplicationState });
  const activation = options.activation ?? new ActivationService({ url: options.url, launchQueue: options.launchQueue, policy: permissions });
  const clipboard = options.clipboardService ?? new ClipboardService({ policy: permissions, clipboard: options.clipboard,
    ClipboardItem: options.ClipboardItem, Blob: options.Blob });
  const launcher = options.launcher ?? new LauncherService({ policy: permissions, open: options.open });
  const interactions = options.interactions ?? new ControlInteractionBindings();
  const remove = activation.on('Activated', args => application.activate(args));
  const lifecycle = options.document ? new VisibilityLifecycle(application, { document: options.document, window: options.window }) : null;
  return { ...options.services, permissions, resources, stringResourceLoader: resources,
    resourceDictionaries: options.resources, application, activation, clipboard, launcher,
    platform: options.platform ?? {}, windowPlatform: options.windowPlatform ?? {}, interactions,
    dispose() {
      lifecycle?.dispose(); remove();
      if (!options.activation) activation.dispose();
      if (!options.application) application.dispose();
      if (!options.resourceLoader) resources.dispose();
      if (!options.interactions) interactions.dispose();
    } };
}
