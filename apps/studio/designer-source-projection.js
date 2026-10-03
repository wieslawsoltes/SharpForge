/** Runtime attachment metadata is never source-authoring state or a reason to rewrite C#. */
export function designerSourceDocument(value) {
  const document = structuredClone(value);
  for (const key of ['designer', 'designTime', 'designerOptions', 'editorState']) delete document[key];
  for (const node of document.nodes) {
    delete node.runtimeId;
    delete node.baseProperties;
  }
  return document;
}

/** A source refresh retains proven runtime identities only for unchanged stable design IDs and control types. */
export function retainDesignerRuntimeBindings(previous, next) {
  next = structuredClone(next);
  const before = new Map(previous.nodes.map(node => [node.id, node]));
  for (const node of next.nodes) {
    const old = before.get(node.id);
    if (old?.type !== node.type || old?.runtimeId === undefined) continue;
    node.runtimeId = old.runtimeId;
    if (old.baseProperties) node.baseProperties = structuredClone(old.baseProperties);
  }
  return next;
}
