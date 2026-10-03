import {decodeWorkspaceFile} from '@sharpforge/archive';
import {FileSystemError, hashFileBytes, throwIfCancelled} from './vfs/provider.js';

const projectFile = /(?:\.(?:[a-z]*proj|props|targets|slnx?|slnf)|(?:^|\/)(?:global\.json|NuGet\.Config))$/i;

/** Host callbacks keep editor ownership explicit; stale reads never replace a newly edited document. */
export class DocumentReloadCoordinator {
  constructor({provider, getDocument, replaceDocument, removeDocument = () => {}, onPrompt = () => {},
    onReevaluate = () => {}, onKeep = () => {}, onError = () => {}, applyChange = null, maxPending = 1024} = {}) {
    if (!provider || typeof getDocument !== 'function' || typeof replaceDocument !== 'function') {
      throw new TypeError('Reload requires a provider and document read/replace callbacks');
    }
    this.provider = provider;
    this.getDocument = getDocument;
    this.replaceDocument = replaceDocument;
    this.removeDocument = removeDocument;
    this.onPrompt = onPrompt;
    this.onReevaluate = onReevaluate;
    this.onKeep = onKeep;
    this.onError = onError;
    this.applyChange = applyChange;
    this.maxPending = maxPending;
    this.pending = new Map();
    this.generations = new Map();
    this.controller = new AbortController();
    this.disposed = false;
  }

  async snapshot(path, signal) {
    try {
      const bytes = await this.provider.readFile(path, {signal});
      return {...decodeWorkspaceFile(path, bytes), hash: await hashFileBytes(bytes, {signal})};
    } catch (error) { if (error.code === 'NotFound') return null; throw error; }
  }

  async handle(event) {
    if (this.disposed || !['changed', 'created', 'deleted', 'renamed'].includes(event.type)) return;
    const signal = this.controller.signal;
    const path = event.oldPath ?? event.path;
    const generation = (this.generations.get(path) ?? 0) + 1;
    this.generations.set(path, generation);
    const initial = this.getDocument(path);
    try {
      const disk = event.type === 'deleted' ? null : await this.snapshot(event.path, signal);
      throwIfCancelled(signal);
      if (this.generations.get(path) !== generation) return;
      const current = this.getDocument(path);
      if (current?.dirty || current && initial?.version !== current.version) {
        if (!this.pending.has(path) && this.pending.size >= this.maxPending) {
          throw new FileSystemError('QuotaExceeded', path, 'External-change prompt limit exceeded');
        }
        const prompt = {path, event, disk, localText: current.text, localVersion: current.version,
          choices: ['reload', 'keep', 'compare']};
        this.pending.set(path, prompt);
        this.onPrompt(prompt);
        return prompt;
      }
      const application = current ? await this.apply(path, disk, event, current.version) : undefined;
      if (projectFile.test(event.path)) await this.onReevaluate({path: event.path, event, disk, application});
      return {path, reloaded: !!current, disk};
    } catch (error) {
      if (!this.disposed) this.onError(error);
      throw error;
    }
  }

  async apply(path, disk, event, expectedVersion) {
    if (this.applyChange) return this.applyChange({path, disk, event, expectedVersion});
    if (disk && typeof disk.text !== 'string') throw new FileSystemError('Conflict', path, 'External file changed to binary');
    if (!disk || event.type === 'renamed') await this.removeDocument(path, {expectedVersion});
    if (disk) await this.replaceDocument(event.path, disk, {expectedVersion: event.type === 'renamed' ? undefined : expectedVersion});
  }

  async choose(path, choice) {
    throwIfCancelled(this.controller.signal);
    const prompt = this.pending.get(path);
    if (!prompt) throw new FileSystemError('NotFound', path, 'No external-change decision is pending');
    if (!['reload', 'keep', 'compare'].includes(choice)) throw new TypeError('Choose reload, keep, or compare');
    const current = this.getDocument(path);
    if (choice === 'compare') return {path, localText: current?.text ?? '', diskText: prompt.disk?.text ?? '', deleted: !prompt.disk};
    if (choice === 'keep') {
      await this.onKeep({path, disk: prompt.disk, document: current});
      this.pending.delete(path);
      return {path, kept: true};
    }
    const fresh = await this.snapshot(prompt.event.path, this.controller.signal);
    if (fresh?.hash !== prompt.disk?.hash) {
      prompt.disk = fresh;
      this.onPrompt({...prompt, changedAgain: true});
      throw new FileSystemError('Conflict', path, 'External file changed again; compare or choose reload again');
    }
    const latest = this.getDocument(path);
    if (latest?.version !== current?.version) throw new FileSystemError('Conflict', path, 'Editor changed while reload was prepared');
    const application = await this.apply(path, fresh, prompt.event, latest?.version);
    this.pending.delete(path);
    if (projectFile.test(prompt.event.path)) {
      await this.onReevaluate({path: prompt.event.path, event: prompt.event, disk: fresh, application});
    }
    return {path, reloaded: true};
  }

  dispose() { this.disposed = true; this.controller.abort(); this.pending.clear(); this.generations.clear(); }
}
