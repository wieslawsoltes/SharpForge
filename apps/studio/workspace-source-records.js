/** Recovery and history own immutable document state, never the live model or its subscriptions. */
export function workspaceDocumentStates(documents) {
  return documents ? new Map(documents.list().map(record => [record.uri, documents.captureState(record.uri)])) : undefined;
}
