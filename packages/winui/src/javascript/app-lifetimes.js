/** Closing a model releases the same retained roots whether initiated by Window or AppWindow. */
export function initializeJavaScriptWindowLifetimes(context) {
  context.windowClosed = owner => {
    if (!owner || !context.objectTree.roots.has(context.id(owner))) return;
    context.sceneJournal?.captureModel(context.objectTree);
    context.objectTree.setConnected(context.id(owner), false);
    context.objectTree.roots.delete(context.id(owner));
    context.controlServices.application.windows.delete(context.id(owner));
    context.send({op: 'close', id: context.id(owner)});
  };
  context.applicationExited = () => {
    for (const id of [...context.objectTree.roots]) context.windowClosed(context.objects.get(id));
  };
  context.controlServices.application.on('Exiting', context.applicationExited);
}
