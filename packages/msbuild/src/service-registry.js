/** Explicit service registry; adapters extend host APIs without patching engine or central action switches. */
export class NativeServiceRegistry {
  constructor() { this.handlers = new Map(); this.disposables = []; }
  register(scope, operation, handler) {
    const key = scope + '/' + operation;
    if (this.handlers.has(key)) throw new Error('Native service already registered: ' + key);
    this.handlers.set(key, handler);
  }
  async invoke(scope, operation, request, options = {}) {
    const handler = this.handlers.get(scope + '/' + operation);
    if (!handler) throw Object.assign(new Error('Unknown native service'), { status: 404 });
    return handler(request, options);
  }
  async close() { for (const disposable of this.disposables) await disposable.close(); }
}
