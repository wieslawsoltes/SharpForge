import {createToolTree} from './tree-host.js';
import {button, runAction} from '../ui.js';
import {MetadataCatalog} from '../metadata/catalog.js';
import {createStudioMetadataSources} from '../metadata/source-provider.js';
import {metadataDefinition} from '../metadata/definition.js';
import {metadataTree} from '../metadata/tree.js';

/** Compatibility entry point for existing hosts that provide inspected summaries. */
export async function objectBrowserNodes(assemblies = []) {
  const catalog = new MetadataCatalog({sources: createStudioMetadataSources({additional: () => assemblies})});
  try {
    const result = await catalog.load();
    return await metadataTree(result.assemblies, result);
  } finally { catalog.dispose(); }
}

export function mountObjectBrowser(host, {assemblies = () => [], metadata, context = () => ({}), inspect, onError}) {
  const catalog = metadata ?? new MetadataCatalog({sources: createStudioMetadataSources({additional: assemblies})});
  let disposed = false, controller, definitionController, generation = 0;
  const tree = createToolTree(host, {label: 'Object Browser', onError, onOpen: async node => {
    if (!node.metadata) return;
    definitionController?.abort();
    definitionController = new AbortController();
    const current = {...context()};
    const {assembly, type, member} = node.metadata;
    const document = await metadataDefinition({assembly, type, members: member ? [member] : []}, {signal: definitionController.signal});
    if (disposed || current.projectId !== context().projectId || current.workspaceEpoch !== context().workspaceEpoch) return;
    if (inspect) await inspect({...node.metadata, document});
    else tree.details.textContent = document.text;
  }});
  const refresh = runAction(async () => {
    controller?.abort();
    definitionController?.abort();
    controller = new AbortController();
    const signal = controller.signal, current = context(), serial = ++generation;
    const projectId = current.projectId, workspaceEpoch = current.workspaceEpoch;
    tree.status.textContent = 'Reading referenced assembly metadata…';
    try {
      const result = await catalog.load({projectId, signal});
      const nodes = await metadataTree(result.assemblies, {...result, signal});
      if (disposed || serial !== generation || context().projectId !== projectId || context().workspaceEpoch !== workspaceEpoch) return;
      tree.setNodes(nodes);
      tree.status.textContent = result.assemblies.length + ' metadata sources' + (projectId ? ' · project ' + projectId : '') +
        (result.diagnostics.length ? ' · ' + result.diagnostics.length + ' unavailable references; select their rows for details' : '') +
        '. PE inspection does not execute referenced code.';
    } catch (error) { if (error.name !== 'AbortError') throw error; }
  }, onError);
  tree.toolbar.append(button(host.ownerDocument, 'Refresh metadata', refresh));
  refresh();
  return {refresh, dispose: () => {
    disposed = true; controller?.abort(); definitionController?.abort(); if (!metadata) catalog.dispose(); tree.dispose();
  }};
}
