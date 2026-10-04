import {validateGuideSettings} from './guides-document.js';

/** Returns a cloned source document with compatible design-only metadata retained from the prior document. */
export function retainDesignMetadata(previousDocument, nextDocument) {
  return retainSourceDesignMetadata(structuredClone(nextDocument), previousDocument);
}

/** Carries preview and editor data across a source read after control identities have been matched. */
export function retainSourceDesignMetadata(document, previous) {
  const before = previous?.document ?? previous;
  if (!before) return document;
  for (const key of ['designer', 'designerOptions', 'editorState']) {
    if (Object.hasOwn(before, key)) document[key] = structuredClone(before[key]);
    else delete document[key];
  }
  if (document.designer?.guides) document.designer.guides = validateGuideSettings(document.designer.guides);
  if (!before.designTime) {
    delete document.designTime;
    return document;
  }
  const originals = new Map((before.nodes ?? []).map(node => [node.id, node]));
  const compatible = new Set(document.nodes.filter(node => {
    const original = originals.get(node.id);
    return original?.type === node.type && original.projectType === node.projectType;
  }).map(node => node.id));
  document.designTime = {...structuredClone(before.designTime), nodes: {}};
  for (const [id, sample] of Object.entries(before.designTime.nodes)) {
    if (compatible.has(id)) document.designTime.nodes[id] = structuredClone(sample);
  }
  return document;
}
