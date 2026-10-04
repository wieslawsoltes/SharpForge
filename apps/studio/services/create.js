import { createServiceRegistry } from './registry.js';
import { createCommandRegistry } from '../commands/registry.js';
import { createMenuRegistry } from '../menus/registry.js';
import { createToolRegistry } from '../tools/registry.js';
import { createAutomationApi } from '../automation-api.js';
import { createDocumentEvents } from './documents.js';
import { createArtifactFilters } from './artifacts.js';
import { createEditorAnnotations } from './annotations.js';

/** Construct independent Studio seams before any optional feature is registered. */
export function createStudioServices() {
  const services = createServiceRegistry();
  services.registerAll([
    { name: 'commands', factory: createCommandRegistry, dispose: value => value.dispose() },
    { name: 'menus', factory: createMenuRegistry, dispose: value => value.dispose() },
    { name: 'tools', factory: createToolRegistry, dispose: value => value.dispose() },
    { name: 'automation', factory: createAutomationApi, dispose: value => value.dispose() },
    { name: 'documents', factory: createDocumentEvents, dispose: value => value.dispose() },
    { name: 'artifacts', factory: createArtifactFilters, dispose: value => value.dispose() },
    { name: 'annotations', factory: createEditorAnnotations, dispose: value => value.dispose() }
  ]);
  return {
    services, commands: services.get('commands'), menus: services.get('menus'),
    tools: services.get('tools'), automation: services.get('automation'), documents: services.get('documents'),
    artifacts: services.get('artifacts'), annotations: services.get('annotations')
  };
}
