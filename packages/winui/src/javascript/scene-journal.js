/** A failed template factory restores touched objects/models without copying the whole application. */
export class JavaScriptSceneJournal {
  constructor(context) {
    this.context = context;
    this.objects = new Map();
    this.stores = new Map();
    this.models = new Map();
    this.created = new Set();
  }
  captureObject(object) {
    if (this.objects.has(object) || this.created.has(object)) return;
    this.objects.set(object, {values: {...object.$values}, locals: new Set(object.$locals),
      collections: {...object.$collections}, parent: this.context.parents.get(object.$node.id)});
  }
  captureStore(store) {
    if (!this.stores.has(store)) this.stores.set(store, store.snapshot());
  }
  captureModel(model) {
    if (model?.snapshot && model?.restore && !this.models.has(model)) this.models.set(model, model.snapshot());
  }
  rollback() {
    const context = this.context;
    context.restoring = true;
    try {
      for (const [object, snapshot] of this.objects) {
        object.$values = {...snapshot.values};
        object.$locals = new Set(snapshot.locals);
        object.$collections = {...snapshot.collections};
        if (snapshot.parent) context.parents.set(object.$node.id, snapshot.parent);
        else context.parents.delete(object.$node.id);
      }
      for (const [store, snapshot] of this.stores) store.restore(snapshot, {resolveParent: owner => owner ? context.storeFor(owner) : null});
      for (const [model, snapshot] of this.models) model.restore(snapshot);
      for (const object of this.created) {
        context.styles.disposeOwner?.(object);
        context.parents.delete(object.$node.id);
        context.states.delete(object);
        context.models.delete(object);
        context.objects.delete(object.$node.id);
      }
    } finally { context.restoring = false; }
  }
}

export function sceneTransaction(context, action) {
  if (context.sceneCommands) return action();
  const commands = [], journal = new JavaScriptSceneJournal(context);
  context.sceneCommands = commands;
  context.sceneJournal = journal;
  try {
    const result = action();
    context.sceneCommands = null;
    context.sceneJournal = null;
    for (const command of commands) context.send(command);
    return result;
  } catch (error) {
    context.sceneJournal = null;
    try { journal.rollback(); }
    finally { context.sceneCommands = null; }
    throw error;
  }
}
