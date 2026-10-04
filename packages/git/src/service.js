import { GitError, checkCancelled, checkLimit } from './errors.js';
import { repositoryOperations } from './service-operations.js';

/** Serialize mutations of each repository without blocking independent repositories. */
export class GitService {
  constructor({ repositoryFactory, operations = [], maxRepositories = 32, maxPending = 128,
    resources = [], serializeError, onDiagnostic = () => {} } = {}) {
    if (typeof repositoryFactory !== 'function') throw new TypeError('GitService requires a repository factory');
    this.repositoryFactory = repositoryFactory;
    this.maxRepositories = checkLimit(maxRepositories, 1024, 'Repository count');
    this.maxPending = checkLimit(maxPending, 10000, 'Pending operation count');
    this.repositories = new Map();
    this.operations = new Map();
    this.requests = new Set();
    this.listeners = new Set();
    this.controller = new AbortController();
    this.resources = [...resources];
    this.serializeError = serializeError ?? (error => GitError.from(error).toJSON());
    this.onDiagnostic = onDiagnostic;
    this.closed = false;
    this.disposal = null;
    for (const definition of [...repositoryOperations, ...operations]) this.register(definition);
  }

  /** Register an explicit operation contract; duplicate operation names are rejected. */
  register({ name, run, mutates = false, global = false }) {
    this.assertOpen();
    if (typeof name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9.]{0,79}$/.test(name) || typeof run !== 'function') {
      throw new TypeError('Malformed Git service operation');
    }
    if (this.operations.has(name)) throw new GitError('Conflict', `Git operation already registered: ${name}`);
    const definition = Object.freeze({ name, run, mutates, global });
    this.operations.set(name, definition);
    return () => { if (this.operations.get(name) === definition) this.operations.delete(name); };
  }

  assertOpen() {
    if (this.closed) throw new GitError('Disposed', 'Git service is disposed');
  }

  onChange(listener) {
    this.assertOpen();
    if (typeof listener !== 'function') throw new TypeError('A change listener is required');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Attach an already opened repository without taking ownership of unrelated sessions. */
  attach(id, repository, { dispose = true, description = {} } = {}) {
    this.assertOpen();
    validateRepositoryId(id);
    if (!repository || typeof repository.status !== 'function') throw new TypeError('A Git repository is required');
    if (this.repositories.has(id)) throw new GitError('Conflict', `Repository is already open: ${id}`);
    checkLimit(this.repositories.size + 1, this.maxRepositories, 'Open repository count');
    this.repositories.set(id, {
      repository, description: Object.freeze({ ...description }), dispose,
      tail: Promise.resolve(), controller: new AbortController(), revision: 0, pending: 0
    });
    return { repositoryId: id, ...description };
  }

  /** All effects are scoped to repositoryId and to the supplied cancellation signal. */
  async request(method, params = {}, options = {}) {
    this.assertOpen();
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new TypeError('Git parameters must be an object');
    checkCancelled(options.signal);
    const id = params.repositoryId ?? 'default';
    validateRepositoryId(id);
    if (method === 'init' || method === 'open') return this.openRepository(id, method, params, options);
    if (method === 'close') return this.closeRepository(id);
    if (method === 'repositories') return this.describeRepositories();
    const operation = this.operations.get(method);
    if (!operation) throw new GitError('Unsupported', `Git operation is not registered: ${method}`);
    if (operation.global) return this.requestGlobal(operation, params, options);
    const entry = this.repositories.get(id);
    if (!entry) throw new GitError('NotFound', `Repository is not open: ${id}`);
    if (entry.closing) throw new GitError('Disposed', `Repository is closing: ${id}`);
    if (entry.opening) throw new GitError('Conflict', `Repository is still opening: ${id}`);
    checkLimit(this.requests.size + 1, this.maxPending, 'Pending Git requests');
    const controller = new AbortController();
    const unlink = linkSignals(controller, [options.signal, entry.controller.signal]);
    const request = { controller, id };
    this.requests.add(request);
    const queued = entry.tail.then(async () => {
      checkCancelled(controller.signal);
      const context = this.context(entry, id, controller.signal, options.onProgress);
      const result = await operation.run(entry.repository, params, context);
      checkCancelled(controller.signal);
      if (operation.mutates) this.changed(entry, id, method);
      return result;
    });
    // The queue is a barrier only; errors remain observable on the caller's result.
    entry.tail = queued.then(() => undefined, () => undefined);
    const settled = queued.finally(() => { unlink(); this.requests.delete(request); });
    request.settled = settled;
    try { return await abortable(settled, controller.signal); }
    catch (error) { throw GitError.from(error); }
  }

  async requestGlobal(operation, params, options) {
    checkLimit(this.requests.size + 1, this.maxPending, 'Pending Git requests');
    const controller = new AbortController();
    const unlink = linkSignals(controller, [options.signal, this.controller.signal]);
    const request = { controller };
    this.requests.add(request);
    const pending = Promise.resolve().then(() => {
      checkCancelled(controller.signal);
      return operation.run(null, params, { signal: controller.signal, onProgress: options.onProgress });
    }).finally(() => { unlink(); this.requests.delete(request); });
    request.settled = pending;
    try { return await abortable(pending, controller.signal); }
    catch (error) { throw GitError.from(error); }
  }

  context(entry, repositoryId, signal, onProgress) {
    return {
      signal, repositoryId, repositoryRevision: entry.revision,
      onProgress: progress => {
        if (!signal.aborted && typeof onProgress === 'function') onProgress({ repositoryId, ...progress });
      }
    };
  }

  async openRepository(id, method, params, { signal, onProgress } = {}) {
    if (this.repositories.has(id)) throw new GitError('Conflict', `Repository is already open: ${id}`);
    checkLimit(this.repositories.size + 1, this.maxRepositories, 'Open repository count');
    checkLimit(this.requests.size + 1, this.maxPending, 'Pending Git requests');
    const reservation = { opening: true, controller: new AbortController(), tail: Promise.resolve() };
    this.repositories.set(id, reservation);
    const unlink = linkSignals(reservation.controller, [signal, this.controller.signal]);
    const request = { controller: reservation.controller, id };
    this.requests.add(request);
    const opening = Promise.resolve().then(async () => {
      let opened;
      try {
        checkCancelled(reservation.controller.signal);
        opened = await this.repositoryFactory({ ...params, method, signal: reservation.controller.signal, onProgress });
        checkCancelled(reservation.controller.signal);
        this.assertOpen();
        if (this.repositories.get(id) !== reservation) throw new GitError('Cancelled', 'Repository open was superseded');
        const repository = opened.repository ?? opened;
        const head = await repository.refs.read('HEAD', { signal: reservation.controller.signal });
        checkCancelled(reservation.controller.signal);
        this.repositories.delete(id);
        this.attach(id, repository, { dispose: opened.repository ? opened.dispose ?? true : true,
          description: opened.description ?? { backend: params.backend ?? 'memory' } });
        return { repositoryId: id, ...(opened.description ?? {}), head };
      } catch (error) {
        try {
          if (typeof opened?.dispose === 'function') await opened.dispose();
          else if (opened?.dispose !== false) await (opened?.repository ?? opened)?.dispose?.();
        } catch (cleanupError) {
          reservation.cleanupError = GitError.from(cleanupError);
          if (!reservation.closing) {
            try { this.onDiagnostic({ kind: 'repository-cleanup-error', error: this.serializeError(cleanupError) }); }
            catch { /* Cleanup errors remain observable on the open or close result. */ }
          }
          throw reservation.cleanupError;
        }
        throw GitError.from(error);
      } finally {
        if (!reservation.closing && this.repositories.get(id) === reservation) this.repositories.delete(id);
      }
    });
    const settled = opening.finally(() => { unlink(); this.requests.delete(request); });
    request.settled = settled;
    reservation.tail = settled.then(() => undefined, () => undefined);
    return abortable(settled, reservation.controller.signal);
  }

  changed(entry, repositoryId, operation) {
    entry.revision++;
    const change = Object.freeze({ repositoryId, operation, revision: entry.revision });
    for (const listener of this.listeners) {
      try { listener(change); }
      catch (error) {
        try { this.onDiagnostic({ kind: 'listener-error', error: this.serializeError(error) }); }
        catch { /* Diagnostics cannot turn an already committed mutation into a failed operation. */ }
      }
    }
  }

  describeRepositories() {
    return [...this.repositories].filter(([, entry]) => !entry.opening && !entry.closing).map(([repositoryId, entry]) => ({
      repositoryId, revision: entry.revision, ...entry.description
    }));
  }

  async closeRepository(id) {
    const entry = this.repositories.get(id);
    if (!entry) return false;
    if (entry.closing) return entry.closePromise;
    entry.closing = true;
    entry.controller.abort();
    entry.closePromise = Promise.resolve().then(async () => {
      await entry.tail;
      if (entry.cleanupError) throw entry.cleanupError;
      if (typeof entry.dispose === 'function') await entry.dispose();
      else if (entry.dispose) await entry.repository.dispose?.();
      return true;
    }).finally(() => { if (this.repositories.get(id) === entry) this.repositories.delete(id); });
    return entry.closePromise;
  }

  dispose() {
    if (this.disposal) return this.disposal;
    this.closed = true;
    this.controller.abort();
    for (const { controller } of this.requests) controller.abort();
    const closing = Promise.allSettled([...this.repositories.keys()].map(id => this.closeRepository(id)));
    const pending = [...this.requests].map(request => request.settled);
    this.disposal = Promise.resolve().then(async () => {
      // In-flight operations retain their own result/error promises; resources outlive their cleanup.
      await Promise.allSettled(pending);
      const results = await closing;
      results.push(...await Promise.allSettled(this.resources.map(resource => resource.dispose?.())));
      this.resources.length = 0;
      this.listeners.clear();
      this.operations.clear();
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, 'Git service disposal failed');
    });
    return this.disposal;
  }
}

export function validateRepositoryId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) {
    throw new GitError('Unsafe', 'Invalid repository identity');
  }
  return id;
}

function linkSignals(controller, signals) {
  const active = signals.filter(Boolean);
  const abort = () => controller.abort();
  for (const signal of active) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  return () => { for (const signal of active) signal.removeEventListener('abort', abort); };
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new GitError('Cancelled', 'Git operation cancelled'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
