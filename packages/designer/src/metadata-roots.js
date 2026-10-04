import {CONTROLS, canonicalType, frameworkAssignable} from '@sharpforge/framework';
import {DesignDocument, designScene, validateDesign} from './model.js';
import {authoringError, qualifiedIdentifier} from './property-diagnostics.js';
import {designPreviewCapability, wrapDesignPreviewRoot} from './source-preview.js';

export function createDesignerRoot(type = 'UserControl', {name = 'DesignedControl', width = 640, height = 480} = {}) {
  type = canonicalType(type);
  if (!['UserControl', 'Page', 'ContentDialog'].map(name => CONTROLS + name).includes(type)) {
    authoringError('SFD1861', 'Choose a UserControl, Page or ContentDialog root.');
  }
  qualifiedIdentifier(name, 'Root class name');
  return new DesignDocument({version: 1, name, width, height, root: 'root', nodes: [
    {id: 'root', type, properties: {Name: name.split('.').at(-1)}, children: ['layout'], events: {}},
    {id: 'layout', type: CONTROLS + 'Grid', properties: {Name: 'LayoutRoot'}, children: [], events: {}}
  ], styles: {}, templates: {}});
}

function remapReference(value, ids) {
  if (value?.$ref && ids.has(value.$ref)) return {$ref: ids.get(value.$ref)};
  return structuredClone(value);
}

/** Explicit per-workspace controls distinguish successful compilation from independently qualified read-only previews. */
export class DesignerRootRegistry {
  constructor({maxDepth = 24, maxNodes = 10000} = {}) {
    this.entries = new Map();
    this.maxDepth = maxDepth;
    this.maxNodes = maxNodes;
  }

  register(descriptor, document, {analysisVersion, successful = true} = {}) {
    if (!successful || descriptor.previewOnly || document?.previewOnly || document?.value?.previewOnly) {
      authoringError('SFD1861', 'Executable project control metadata requires a successful compilation.');
    }
    return this.#store(descriptor, document, analysisVersion);
  }

  /** Rechecks the exact source capability and wraps only its proven instance content; this never claims executable support. */
  registerPreview(descriptor, analysis, {analysisVersion} = {}) {
    const capability = designPreviewCapability(analysis);
    if (!capability.previewAvailable || descriptor.previewOnly !== true || descriptor.readOnly !== true
      || descriptor.compilationSucceeded !== false) {
      authoringError('SFD1861', 'Preview registration requires a source-proven read-only component.');
    }
    const preview = wrapDesignPreviewRoot(analysis, descriptor);
    return this.#store({...descriptor, ...capability.descriptor}, preview.document, analysisVersion);
  }

  #store(descriptor, document, analysisVersion) {
    qualifiedIdentifier(descriptor.type, 'Project control type');
    const baseType = canonicalType(descriptor.baseType);
    if (!Number.isSafeInteger(analysisVersion) || analysisVersion < 0
      || descriptor.analysisVersion !== undefined && descriptor.analysisVersion !== analysisVersion) {
      authoringError('SFD1861', 'Project control metadata requires the current, matching analysis version.');
    }
    if (!frameworkAssignable(CONTROLS + 'Control', baseType)) authoringError('SFD1861', 'Project type must derive from Control.');
    if ((this.entries.get(descriptor.type)?.descriptor.analysisVersion ?? -1) > analysisVersion) {
      authoringError('SFD1861', 'Stale compilation metadata cannot replace a newer project-control preview.');
    }
    const value = validateDesign(document?.value ?? document);
    if (value.nodes.find(node => node.id === value.root).type !== baseType) authoringError('SFD1861', 'Project document root type mismatch.');
    const entry = {descriptor: {...descriptor, baseType, analysisVersion}, document: value};
    this.entries.set(descriptor.type, entry);
    return () => { if (this.entries.get(descriptor.type) === entry) this.entries.delete(descriptor.type); };
  }

  descriptors() { return [...this.entries.values()].map(entry => structuredClone(entry.descriptor)); }

  definition(node) {
    const entry = this.entries.get(node.projectType);
    return entry ? {type: entry.descriptor.type, uri: entry.descriptor.uri, document: structuredClone(entry.document)} : null;
  }

  project(design, input = designScene(design), {createScene = designScene} = {}) {
    const scene = structuredClone(input);
    const diagnostics = [];
    const expand = (document, mapping, ancestry, depth) => {
      if (depth > this.maxDepth) authoringError('SFD1861', 'Nested project-control depth limit.');
      const descriptors = new Map((document.projectTypes ?? []).map(descriptor => [descriptor.type, descriptor]));
      for (const node of document.nodes) {
        if (!node.projectType) continue;
        const entry = this.entries.get(node.projectType);
        const expected = descriptors.get(node.projectType);
        if (!entry || expected?.uri && expected.uri !== entry.descriptor.uri
          || expected?.baseType && canonicalType(expected.baseType) !== entry.descriptor.baseType) {
          diagnostics.push({code: 'SFD1862', severity: 'warning', span: null, nodeId: node.id,
            message: `Preview for ${node.projectType} is unavailable until its current construction is qualified.`});
          continue;
        }
        if (ancestry.has(node.projectType)) authoringError('SFD1861', 'Recursive project-control composition.');
        const ownerId = mapping.get(node.id) ?? node.id;
        const owner = scene.nodes.find(candidate => candidate.id === ownerId);
        const nested = createScene(entry.document);
        const nestedIds = new Map(nested.nodes.map(child => [child.id, ownerId + '::component:' + child.id]));
        for (const child of nested.nodes) {
          const clone = {...child, id: nestedIds.get(child.id), designId: owner.designId ?? owner.id,
            componentDocument: entry.descriptor.uri, properties: {}, collections: {}, events: []};
          for (const [name, value] of Object.entries(child.properties)) clone.properties[name] = remapReference(value, nestedIds);
          for (const [name, values] of Object.entries(child.collections)) clone.collections[name] = values.map(value => remapReference(value, nestedIds));
          if (child.templateRoot) clone.templateRoot = nestedIds.get(child.templateRoot);
          scene.nodes.push(clone);
        }
        owner.properties.Content = {$ref: nestedIds.get(entry.document.root)};
        owner.componentDocument = entry.descriptor.uri;
        if (scene.nodes.length > this.maxNodes) authoringError('SFD1861', 'Nested project-control preview node limit.');
        expand(entry.document, nestedIds, new Set([...ancestry, node.projectType]), depth + 1);
      }
    };
    expand(design, new Map(), new Set(), 0);
    return {scene, diagnostics};
  }
}
