/** Two-way visual selection uses the attachment's app identity, never the active debugger selection. */
export class DesignerLiveSelection {
  constructor(view, attachment) {
    this.view = view;
    this.attachment = attachment;
    this.applying = false;
    this.disposed = false;
    this.unsubscribe = attachment.sessions.subscribeSelection(event => this.fromTree(event));
  }

  fromDesigner() {
    const target = this.attachment.target;
    if (this.disposed || this.applying || !target) return;
    const runtimeIds = this.view.document.selection.map(id => this.view.document.node(id)?.runtimeId).filter(id => id !== undefined);
    this.attachment.sessions.select(target.sessionId, target.generation, runtimeIds, {origin: this});
  }

  fromTree(event) {
    const target = this.attachment.target;
    if (this.disposed || !target || this.applying || event.origin === this ||
      event.sessionId !== target.sessionId || event.generation !== target.generation) return;
    this.attachment.resolve(target);
    const runtimeIds = new Set(event.runtimeIds.map(String));
    const ids = this.view.document.value.nodes.filter(node => runtimeIds.has(String(node.runtimeId))).map(node => node.id);
    if (!ids.length) return;
    this.applying = true;
    try {
      this.view.document.select(ids);
    } finally {
      this.applying = false;
    }
  }

  dispose() {
    this.disposed = true;
    this.unsubscribe();
  }
}
