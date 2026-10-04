import {designFromScene, designPatch, validateDesign} from './model.js';
import {bindLinkedLiveDesign} from './live-source-binding.js';

export {bindLinkedLiveDesign, LiveSourceBindingError} from './live-source-binding.js';
export {LiveDesignCapabilityError} from './live-capabilities.js';

/** Stable failure codes for stale targets, unsupported channels and conflicting live operations. */
export class DesignerLiveError extends Error {
  constructor(message, code = 'SFDL0001', details = {}) {
    super(message);
    this.name = 'DesignerLiveError';
    this.code = code;
    this.source = 'Designer';
    Object.assign(this, details);
  }
}

function identity(sessionId, generation) {
  if (!['string', 'number'].includes(typeof sessionId) || String(sessionId).length > 256 || String(sessionId) === '') {
    throw new TypeError('App session id must be a bounded string or number');
  }
  if (typeof sessionId === 'number' && (!Number.isSafeInteger(sessionId) || sessionId < 0)) throw new TypeError('Invalid numeric app session id');
  if (!Number.isSafeInteger(generation) || generation < 0) throw new TypeError('App session generation must be nonnegative');
}

function canceled(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Live designer request canceled', 'AbortError');
}

/** Explicit app-session registry. Request channels are immutable within a generation. */
export class DesignerAppSessions {
  constructor({limit = 32} = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 256) throw new RangeError('Invalid live session limit');
    this.limit = limit;
    this.sessions = new Map();
    this.listeners = new Set();
    this.selectionListeners = new Set();
    this.disposed = false;
  }

  register(descriptor) {
    if (this.disposed) throw new DesignerLiveError('App session registry is disposed', 'SFDL0005');
    identity(descriptor.sessionId, descriptor.generation);
    if ('token' in descriptor) throw new TypeError('App attachment tokens are registry-owned');
    if (typeof descriptor.request !== 'function') throw new TypeError('Each app session requires its own request channel');
    const previous = this.sessions.get(descriptor.sessionId);
    if (!previous && this.sessions.size >= this.limit) throw new RangeError('Live app session limit exceeded');
    if (previous && descriptor.generation < previous.generation) throw new DesignerLiveError('Older app generation rejected');
    if (previous?.generation === descriptor.generation && previous.request !== descriptor.request) {
      throw new DesignerLiveError('A request channel cannot change without a new app generation');
    }
    const session = previous?.generation === descriptor.generation ? previous : {
      sessionId: descriptor.sessionId, generation: descriptor.generation, request: descriptor.request,
      selection: [], token: {}, uiActive: false
    };
    Object.assign(session, descriptor);
    this.sessions.set(session.sessionId, session);
    this.notify();
    return session;
  }

  update(sessionId, generation, changes) {
    const session = this.resolve(sessionId, generation, {active: false});
    if ('request' in changes || 'generation' in changes || 'sessionId' in changes || 'token' in changes) {
      throw new TypeError('Identity changes require app session registration');
    }
    Object.assign(session, changes);
    this.notify();
  }

  resolve(sessionId, generation, {active = true} = {}) {
    if (this.disposed) throw new DesignerLiveError('App session registry is disposed', 'SFDL0005');
    const session = this.sessions.get(sessionId);
    if (!session || session.generation !== generation || active && !session.uiActive) {
      throw new DesignerLiveError('The attached app was closed or restarted. Attach its current session again.', 'SFDL0001');
    }
    const state = session.getState?.();
    if (state && (state.generation !== generation || state.sessionId !== sessionId || active && !state.uiActive)) {
      throw new DesignerLiveError('The attached app generation is stale. No command was sent.', 'SFDL0001');
    }
    return session;
  }

  get(sessionId) { return this.sessions.get(sessionId) ?? null; }
  list() { return [...this.sessions.values()].filter(session => session.uiActive); }

  remove(sessionId, generation) {
    if (this.sessions.get(sessionId)?.generation !== generation) return false;
    this.sessions.delete(sessionId);
    this.notify();
    return true;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() { for (const listener of this.listeners) listener(this.list()); }

  subscribeSelection(listener) {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  select(sessionId, generation, runtimeIds, {origin = null, fromTree = false} = {}) {
    const session = this.resolve(sessionId, generation);
    if (!Array.isArray(runtimeIds) || runtimeIds.length > 1000 || runtimeIds.some(id => !['string', 'number'].includes(typeof id))) {
      throw new TypeError('Live visual selection contains invalid runtime ids');
    }
    session.selection = [...new Set(runtimeIds)];
    if (!fromTree) session.selectVisual?.(session.selection, {sessionId, generation, origin});
    const event = {sessionId, generation, runtimeIds: session.selection, origin};
    for (const listener of this.selectionListeners) listener(event);
    return event;
  }

  dispose() {
    this.disposed = true;
    this.sessions.clear();
    this.listeners.clear();
    this.selectionListeners.clear();
  }
}

/** An attachment is bound to one registry generation; active debugger selection is never consulted. */
export class LiveDesignAttachment {
  constructor(sessions) {
    if (!(sessions instanceof DesignerAppSessions)) throw new TypeError('An explicit app session registry is required');
    this.sessions = sessions;
    this.target = null;
    this.epoch = 0;
    this.busy = false;
    this.disposed = false;
  }

  resolve(target = this.target) {
    if (this.disposed || !target) throw new DesignerLiveError('Attach a running application first', 'SFDL0002');
    const session = this.sessions.resolve(target.sessionId, target.generation);
    if (session.token !== target.token) throw new DesignerLiveError('The app attachment was replaced', 'SFDL0001');
    return session;
  }

  async request(target, method, parameters = {}, signal) {
    canceled(signal);
    const session = this.resolve(target);
    const result = await session.request(method, {
      ...parameters, sessionId: session.runtimeSessionId ?? target.sessionId, sessionGeneration: target.generation
    }, {signal});
    canceled(signal);
    this.resolve(target);
    return result;
  }

  async attach(sessionId, {
    generation = this.sessions.get(sessionId)?.generation, windowId, signal, linkedDocument, linkedBaseline = linkedDocument, assertCurrent
  } = {}) {
    if (this.disposed) throw new DesignerLiveError('Live attachment is disposed', 'SFDL0005');
    identity(sessionId, generation);
    const session = this.sessions.resolve(sessionId, generation);
    const epoch = ++this.epoch;
    const target = {sessionId, generation, token: session.token};
    const snapshot = await this.request(target, 'designSnapshot', {}, signal);
    if (epoch !== this.epoch) throw new DesignerLiveError('A newer attachment superseded this request', 'SFDL0004');
    if (!Number.isSafeInteger(snapshot?.revision) || snapshot.revision < 0) {
      throw new DesignerLiveError('The running app returned an invalid scene revision', 'SFDL0003');
    }
    const scene = snapshot.scene;
    if (windowId !== undefined && !scene.windows.includes(windowId)) {
      throw new DesignerLiveError('The chosen app window no longer exists', 'SFDL0001');
    }
    const selectedScene = windowId === undefined ? scene : {...scene, windows: [windowId]};
    const collectionOwners = linkedBaseline?.nodes.filter(node => Object.hasOwn(node.collections ?? {}, 'Items'))
      .map(node => ({type: node.type, name: node.properties.Name ?? ''}));
    const captured = designFromScene(selectedScene, {name: session.projectName ?? session.windowTitle ?? 'Running app', collectionOwners});
    const bound = linkedDocument ? bindLinkedLiveDesign(linkedDocument, captured, {scene, baseline: linkedBaseline}) : null;
    const document = bound?.document ?? captured;
    Object.assign(target, {
      baseline: bound?.baseline ?? structuredClone(document), revision: snapshot.revision, sceneRevision: snapshot.revision,
      codeVersion: session.codeVersion ?? 0, sourceLinked: !!bound
    });
    assertCurrent?.();
    this.target = target;
    return {document, live: target};
  }

  /** Adopt a prepared target in another designer; the registry token and generation remain authoritative. */
  adopt(target) {
    this.resolve(target);
    if (this.busy) throw new DesignerLiveError('Wait for the pending live update before changing the attachment', 'SFDL0004');
    if (!Number.isSafeInteger(target.sceneRevision) || target.sceneRevision < 0) {
      throw new DesignerLiveError('The prepared attachment has an invalid scene revision', 'SFDL0003');
    }
    const baseline = validateDesign(target.baseline);
    this.epoch++;
    this.target = {...target, baseline};
    return this.target;
  }

  async apply(document, {signal} = {}) {
    if (this.busy) throw new DesignerLiveError('A live designer update is already pending', 'SFDL0004');
    const target = this.target;
    this.resolve(target);
    const epoch = this.epoch;
    const sent = validateDesign(document);
    const patch = designPatch(target.baseline, sent);
    this.busy = true;
    try {
      const result = await this.request(target, 'applyDesign', {patch, expectedRevision: target.sceneRevision}, signal);
      if (epoch !== this.epoch || target !== this.target) throw new DesignerLiveError('Designer target changed during apply', 'SFDL0004');
      if (!Number.isSafeInteger(result?.revision) || result.revision < target.sceneRevision || !result.bindings) {
        throw new DesignerLiveError('The running app returned an invalid apply result', 'SFDL0003');
      }
      for (const node of sent.nodes) {
        if (Object.hasOwn(result.bindings, node.id)) node.runtimeId = result.bindings[node.id];
      }
      target.baseline = sent;
      target.revision = result.revision;
      target.sceneRevision = result.revision;
      return {...result, document: sent};
    } finally {
      this.busy = false;
    }
  }

  async hotReload(document, {writeSource, compile, signal} = {}) {
    const target = this.target;
    const session = this.resolve(target);
    if (this.busy) throw new DesignerLiveError('A live designer update is already pending', 'SFDL0004');
    if (typeof writeSource !== 'function' || typeof (compile ?? session.compile) !== 'function') {
      throw new DesignerLiveError('This app session does not provide source editing and compilation for Hot Reload', 'SFDL0006');
    }
    if (!['paused', 'waiting', 'terminated'].includes(session.state)) {
      throw new DesignerLiveError('Pause the attached app before applying source and Hot Reload', 'SFDL0007');
    }
    const epoch = this.epoch;
    const sent = validateDesign(document);
    const patch = designPatch(target.baseline, sent);
    this.busy = true;
    let sourceWritten = false;
    let codeApplied = false;
    try {
      canceled(signal);
      session.assertSourceOwnership?.();
      await writeSource({sessionId: target.sessionId, generation: target.generation, signal});
      sourceWritten = true;
      this.resolve(target);
      canceled(signal);
      const compiled = await (compile ?? session.compile)({sessionId: target.sessionId, generation: target.generation, signal});
      this.resolve(target);
      if (epoch !== this.epoch) throw new DesignerLiveError('Designer attachment changed during compilation', 'SFDL0004');
      if (!compiled?.success) throw new DesignerLiveError('Source compilation failed; running code is unchanged', 'SFDL0008', {
        diagnostics: compiled?.diagnostics ?? []
      });
      const payload = session.profile === 'managed-il' ? {assembly: compiled.assembly} : {image: compiled.image};
      if (!payload.assembly && !payload.image) throw new DesignerLiveError('Hot Reload compilation produced no executable output', 'SFDL0008');
      const code = await this.request(target, 'hotReload', {...payload, expectedVersion: target.codeVersion}, signal);
      codeApplied = true;
      target.codeVersion = code.codeVersion ?? target.codeVersion + 1;
      if (epoch !== this.epoch || target !== this.target) throw new DesignerLiveError('Attachment changed after the code update', 'SFDL0004');
      const applied = await this.request(target, 'applyDesign', {patch, expectedRevision: target.sceneRevision}, signal);
      if (epoch !== this.epoch || target !== this.target) throw new DesignerLiveError('Designer target changed during Hot Reload', 'SFDL0004');
      if (!Number.isSafeInteger(applied?.revision) || applied.revision < target.sceneRevision || !applied.bindings) {
        throw new DesignerLiveError('Invalid live scene response after Hot Reload', 'SFDL0003');
      }
      for (const node of sent.nodes) if (Object.hasOwn(applied.bindings, node.id)) node.runtimeId = applied.bindings[node.id];
      target.baseline = sent;
      target.revision = applied.revision;
      target.sceneRevision = applied.revision;
      return {...applied, codeVersion: target.codeVersion, sourceWritten: true, document: sent};
    } catch (failure) {
      const error = failure instanceof Error ? failure : new DesignerLiveError(String(failure));
      error.sourceWritten = sourceWritten;
      error.codeApplied = codeApplied;
      throw error;
    } finally {
      this.busy = false;
    }
  }

  detach() {
    this.epoch++;
    this.target = null;
  }

  dispose() {
    this.detach();
    this.disposed = true;
  }
}
