/** States describe staged alternatives; in-flight work is exposed separately as pending tokens. */
export const DesignSyncState = Object.freeze({
  Synced: 'synced',
  SourceDirty: 'source-dirty',
  DesignDirty: 'design-dirty',
  Conflict: 'conflict',
  Blocked: 'blocked',
  Missing: 'missing',
});

const tokenFields = Object.freeze([
  'protocolVersion', 'id', 'kind', 'resolution', 'workspaceId', 'uri', 'generation',
  'sourceVersion', 'sourceRevision', 'designRevision',
]);
const identityFields = tokenFields.slice(4);
const makeDiagnostic = (code, message) => ({code, severity: 'error', message, span: null});

function fail(code, message) {
  const error = new Error(message);
  error.name = 'DesignSyncProtocolError';
  error.code = code;
  error.diagnostic = makeDiagnostic(code, message);
  throw error;
}

function integer(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    fail('SFSYNC_ARGUMENT', `${name} must be a nonnegative safe integer at most ${maximum}.`);
  }
  return value;
}

function next(value, name) {
  return integer(value + 1, name);
}

function identifier(value, name) {
  if (typeof value !== 'string' || !value.length || value.length > 4096) {
    fail('SFSYNC_ARGUMENT', `${name} must contain between 1 and 4096 UTF-16 code units.`);
  }
  return value;
}

/** Canonical plain JSON, bounded before copying; accessors and executable serializers are not evaluated. */
function dataJson(input, maximum) {
  let length = 0;
  let entries = 0;
  const ancestors = new Set();
  const charge = amount => {
    length += amount;
    if (length > maximum) fail('SFSYNC_LIMIT', 'Synchronization data exceeds the UTF-16 serialization limit.');
  };
  function copy(value, depth) {
    if (++entries > 100_000 || depth > 100) fail('SFSYNC_LIMIT', 'Synchronization data size or nesting limit exceeded.');
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) {
      charge(String(value).length);
      return value;
    }
    if (typeof value === 'string') {
      if (value.length > maximum) fail('SFSYNC_LIMIT', 'Synchronization string limit exceeded.');
      charge(JSON.stringify(value).length);
      return value;
    }
    if (!value || typeof value !== 'object' || ancestors.has(value)) {
      fail('SFSYNC_DATA', 'Synchronization documents and previews must contain acyclic plain JSON data.');
    }
    const array = Array.isArray(value);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      fail('SFSYNC_DATA', 'Synchronization data must use plain objects and arrays.');
    }
    const keys = Object.keys(value).sort();
    if (keys.length > 100_000 || array && keys.length !== value.length) {
      fail('SFSYNC_LIMIT', 'Synchronization collection limit exceeded or array is sparse.');
    }
    charge(2 + Math.max(0, keys.length - 1));
    ancestors.add(value);
    const result = array ? [] : Object.create(null);
    for (let index = 0; index < keys.length; index++) {
      const key = array ? String(index) : keys[index];
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('SFSYNC_DATA', 'Accessors are not synchronization data.');
      if (!array) charge(JSON.stringify(key).length + 1);
      result[key] = copy(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
    return result;
  }
  return JSON.stringify(copy(input, 0));
}

/**
 * Coordinates already validated source/design candidates without parsing, executing, or editing a host editor.
 * begin/accept/reject are explicit transactions; callers own compilation, editor undo/redo and source persistence.
 * Tokens survive JSON transport. A replacement instance must receive a new caller-owned generation.
 * Token checks are O(1); staging data is bounded by maxDataLength, 100,000 values and depth 100.
 */
export class DesignSyncProtocol {
  #identity;
  #text;
  #sourceVersion;
  #sourceRevision = 0;
  #designRevision;
  #design;
  #preview;
  #baseline;
  #pending = new Map();
  #serial = 0;
  #diagnostic = null;
  #missing = false;
  #disposed = false;
  #origin = 'initialize';
  #limits;

  constructor({workspaceId = 'default', uri = 'DesignedView.g.cs', sourceText = '', sourceVersion = 0,
    document = null, designRevision = 0, generation = 0, maxPending = 8,
    maxSourceLength = 2_000_000, maxDataLength = 4_000_000} = {}) {
    this.#identity = {
      workspaceId: identifier(workspaceId, 'workspaceId'), uri: identifier(uri, 'uri'),
      generation: integer(generation, 'generation'),
    };
    this.#limits = {
      pending: integer(maxPending, 'maxPending', 1024),
      source: integer(maxSourceLength, 'maxSourceLength', 32_000_000),
      data: integer(maxDataLength, 'maxDataLength', 32_000_000),
    };
    if (!this.#limits.pending || !this.#limits.data) fail('SFSYNC_ARGUMENT', 'Pending and data limits must be positive.');
    this.#text = this.#sourceText(sourceText);
    this.#sourceVersion = integer(sourceVersion, 'sourceVersion');
    this.#designRevision = integer(designRevision, 'designRevision');
    this.#design = dataJson(document, this.#limits.data);
    this.#preview = this.#design;
    this.#baseline = document === null ? null : this.#captureBaseline();
  }

  get disposed() { return this.#disposed; }
  get sourceDirty() {
    return !this.#baseline || this.#baseline.generation !== this.#identity.generation || this.#baseline.text !== this.#text;
  }
  get designDirty() { return this.#design !== (this.#baseline?.document ?? 'null'); }
  get document() { return JSON.parse(this.#design); }
  get lastValidPreview() { return JSON.parse(this.#preview); }
  get source() {
    return {...this.#identity, text: this.#text, version: this.#sourceVersion, revision: this.#sourceRevision, missing: this.#missing};
  }
  get state() {
    if (this.#missing) return DesignSyncState.Missing;
    if (this.sourceDirty && this.designDirty) return DesignSyncState.Conflict;
    if (this.#diagnostic) return DesignSyncState.Blocked;
    if (this.sourceDirty) return DesignSyncState.SourceDirty;
    return this.designDirty ? DesignSyncState.DesignDirty : DesignSyncState.Synced;
  }

  /** Returns detached data; modifying a snapshot cannot change pending work or its baselines. */
  snapshot() {
    const baseline = this.#baseline && {...this.#baseline, document: JSON.parse(this.#baseline.document)};
    return {
      state: this.state, disposed: this.#disposed, source: this.source, designRevision: this.#designRevision,
      sourceDirty: this.sourceDirty, designDirty: this.designDirty, document: this.document,
      lastValidPreview: this.lastValidPreview, baseline, origin: this.#origin,
      diagnostic: this.#diagnostic && {...this.#diagnostic}, pending: [...this.#pending.values()].map(entry => ({...entry.token})),
    };
  }

  /** Stages an editor revision, including undo/redo; versions must increase when text changes. */
  sourceChanged(text, {sourceVersion, origin = 'editor'} = {}) {
    this.#ensureActive();
    text = this.#sourceText(text);
    const changed = text !== this.#text || this.#missing;
    const version = sourceVersion ?? (changed ? next(this.#sourceVersion, 'sourceVersion') : this.#sourceVersion);
    this.#checkRevision(version, this.#sourceVersion, changed, 'sourceVersion');
    const nextOrigin = identifier(origin, 'origin');
    if (!changed && version === this.#sourceVersion) return {changed: false, state: this.state};
    const revision = next(this.#sourceRevision, 'sourceRevision');
    this.#text = text;
    this.#sourceVersion = version;
    this.#sourceRevision = revision;
    this.#missing = false;
    this.#changed(nextOrigin);
    return {changed: true, state: this.state};
  }

  /** Stages a design alternative; comparison is independent of object property insertion order. */
  designChanged(document, {designRevision, origin = 'editor'} = {}) {
    this.#ensureActive();
    const candidate = dataJson(document, this.#limits.data);
    const changed = candidate !== this.#design;
    const revision = designRevision ?? (changed ? next(this.#designRevision, 'designRevision') : this.#designRevision);
    this.#checkRevision(revision, this.#designRevision, changed, 'designRevision');
    const nextOrigin = identifier(origin, 'origin');
    if (!changed && revision === this.#designRevision) return {changed: false, state: this.state};
    this.#design = candidate;
    this.#designRevision = revision;
    this.#changed(nextOrigin);
    return {changed: true, state: this.state};
  }

  /** A branch/workspace replacement invalidates even equal-text, equal-version work and retains staged design. */
  replaceSource(text, {workspaceId = this.#identity.workspaceId, uri = this.#identity.uri,
    sourceVersion = 0, origin = 'external'} = {}) {
    this.#ensureActive();
    const identity = {
      workspaceId: identifier(workspaceId, 'workspaceId'), uri: identifier(uri, 'uri'),
      generation: next(this.#identity.generation, 'generation'),
    };
    const source = this.#sourceText(text);
    const version = integer(sourceVersion, 'sourceVersion');
    const revision = next(this.#sourceRevision, 'sourceRevision');
    const nextOrigin = identifier(origin, 'origin');
    this.#identity = identity;
    this.#text = source;
    this.#sourceVersion = version;
    this.#sourceRevision = revision;
    this.#missing = false;
    this.#changed(nextOrigin);
    return {changed: true, state: this.state};
  }

  /** Records deletion without destroying the last source, staged design, baseline or valid preview. */
  markMissing() {
    this.#ensureActive();
    this.#identity.generation = next(this.#identity.generation, 'generation');
    this.#missing = true;
    this.#changed('missing');
    return {changed: true, state: this.state};
  }

  /** Begins a source analysis or design write; selecting a conflicting alternative requires explicit resolution. */
  begin(kind, {resolution = null, signal} = {}) {
    this.#ensureActive();
    if (kind !== 'source' && kind !== 'design') fail('SFSYNC_ARGUMENT', 'Transaction kind must be source or design.');
    if (resolution !== null && resolution !== kind) fail('SFSYNC_ARGUMENT', 'Resolution must select the transaction kind.');
    if (this.#missing) fail('SFSYNC_MISSING', 'The linked source file is missing.');
    if ((kind === 'source' ? this.designDirty : this.sourceDirty) && resolution !== kind) {
      fail('SFSYNC_CONFLICT', 'Both alternatives are retained. Explicitly choose source or design before synchronization.');
    }
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
      fail('SFSYNC_ARGUMENT', 'signal must implement AbortSignal.');
    }
    if (signal?.aborted) fail('SFSYNC_CANCELLED', 'Synchronization was cancelled before it began.');
    if (this.#pending.size >= this.#limits.pending) fail('SFSYNC_LIMIT', 'Pending synchronization transaction limit exceeded.');
    const id = next(this.#serial, 'transaction id');
    const token = Object.freeze({protocolVersion: 1, id, kind, resolution, ...this.#identity,
      sourceVersion: this.#sourceVersion, sourceRevision: this.#sourceRevision, designRevision: this.#designRevision});
    const abort = signal ? () => this.cancel(token) : null;
    this.#serial = id;
    this.#pending.set(id, {token, signal, abort});
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) this.cancel(token);
    return token;
  }

  /** Recheck immediately before the host's atomic version-guarded edit; a Boolean check never mutates state. */
  isCurrent(token) { return this.#tokenProblem(token) === null; }

  /**
   * Accepts a caller-validated candidate. Error diagnostics or valid/success=false reject it.
   * Source reads cannot alter text; design writes require text. Returns before/after snapshots for editor history.
   * The host must apply source edits atomically with the same token and its own source-version guard.
   */
  accept(token, candidate = {}) { return this.#acceptCandidate(token, candidate); }

  /** Qualified previews may advance while compiler errors keep source writes blocked. */
  acceptPreview(token, candidate = {}) {
    const capability = candidate.capability;
    const permitsPreview = ['component', 'composition', 'events'].includes(capability?.kind) && capability.readOnly === true
      || capability?.kind === 'resources'
      && capability.readOnly === false && capability.stageDesign === true;
    if (token?.kind !== 'source' || candidate.success !== false || capability?.previewAvailable !== true
      || !permitsPreview || capability.sourceWrites !== false) {
      fail('SFSYNC_ARGUMENT', 'Preview acceptance requires an explicit source preview capability and failed compilation.');
    }
    return this.#acceptCandidate(token, candidate, true);
  }

  #acceptCandidate(token, {document, text, sourceVersion, designRevision, preview, diagnostics = [], valid = true, success = true},
    previewOnly = false) {
    const problem = this.#tokenProblem(token);
    if (problem) return problem;
    const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error');
    if (!valid || !previewOnly && (!success || errors.length)) {
      return this.reject(token, errors[0] ?? {code: 'SFSYNC_INVALID', message: 'Candidate validation failed.'});
    }
    const currentText = text ?? this.#text;
    if (token.kind === 'source' && currentText !== this.#text) fail('SFSYNC_ARGUMENT', 'Source analysis cannot change source text.');
    if (token.kind === 'design' && typeof text !== 'string') fail('SFSYNC_ARGUMENT', 'Design writes require generated source text.');
    const candidateText = this.#sourceText(currentText);
    const candidate = dataJson(document, this.#limits.data);
    if (document === null) fail('SFSYNC_DATA', 'An accepted candidate must contain a valid design document.');
    const candidatePreview = preview === undefined ? candidate : dataJson(preview, this.#limits.data);
    const textChanged = candidateText !== this.#text;
    const version = sourceVersion ?? (textChanged ? next(this.#sourceVersion, 'sourceVersion') : this.#sourceVersion);
    this.#checkRevision(version, this.#sourceVersion, textChanged, 'sourceVersion');
    if (token.kind === 'source' && version !== this.#sourceVersion) fail('SFSYNC_STALE', 'Source analysis version changed.');
    const changedDesign = candidate !== this.#design;
    const revision = designRevision ?? (changedDesign ? next(this.#designRevision, 'designRevision') : this.#designRevision);
    this.#checkRevision(revision, this.#designRevision, changedDesign, 'designRevision');
    const sourceRevision = next(this.#sourceRevision, 'sourceRevision');
    const latestProblem = this.#tokenProblem(token);
    if (latestProblem) return latestProblem;
    const before = this.snapshot();
    this.#text = candidateText;
    this.#sourceVersion = version;
    this.#sourceRevision = sourceRevision;
    this.#design = candidate;
    this.#designRevision = revision;
    this.#preview = candidatePreview;
    this.#baseline = this.#captureBaseline();
    this.#changed(token.kind === 'source' ? 'source sync' : 'design sync');
    if (previewOnly) {
      this.#diagnostic = makeDiagnostic(errors[0]?.code ?? 'SFSYNC_COMPILE', errors[0]?.message ?? 'Source writes remain blocked for this preview.');
    }
    return {accepted: true, ...(previewOnly ? {previewOnly: true} : {}), state: this.state, token: {...token}, before, after: this.snapshot()};
  }

  /** Rejects only a current operation; stale errors cannot replace newer diagnostics or staged alternatives. */
  reject(token, {code = 'SFSYNC_BLOCKED', message = 'Synchronization candidate was rejected.'} = {}) {
    const problem = this.#tokenProblem(token);
    if (problem) return problem;
    const diagnostic = makeDiagnostic(identifier(code, 'diagnostic code'), identifier(message, 'diagnostic message'));
    this.#release(token.id);
    this.#diagnostic = diagnostic;
    return {accepted: false, reason: 'blocked', state: this.state, diagnostic: {...diagnostic}};
  }

  /** Cancels a pending operation without changing either alternative or its preview. */
  cancel(token) {
    const problem = this.#tokenProblem(token, false);
    if (problem) return problem;
    this.#release(token.id);
    return {accepted: false, reason: 'cancelled', state: this.state,
      diagnostic: makeDiagnostic('SFSYNC_CANCELLED', 'Synchronization was cancelled.')};
  }

  /** Idempotently detaches cancellation listeners and invalidates all work; snapshots remain available for recovery. */
  dispose() {
    if (this.#disposed) return false;
    this.#clearPending();
    this.#disposed = true;
    return true;
  }

  #sourceText(text) {
    if (typeof text !== 'string') fail('SFSYNC_ARGUMENT', 'Source must be a string.');
    if (text.length > this.#limits.source) fail('SFSYNC_LIMIT', 'Source exceeds the UTF-16 code-unit limit.');
    return text;
  }

  #checkRevision(value, previous, changed, name) {
    integer(value, name);
    if (value < previous || changed && value === previous) fail('SFSYNC_STALE', `${name} does not identify a newer revision.`);
  }

  #captureBaseline() {
    return {...this.#identity, text: this.#text, sourceVersion: this.#sourceVersion, sourceRevision: this.#sourceRevision,
      designRevision: this.#designRevision, document: this.#design};
  }

  #tokenProblem(token, checkSignal = true) {
    let reason = null;
    if (this.#disposed) reason = 'disposed';
    else if (!token || token.protocolVersion !== 1 || !Number.isSafeInteger(token.id)) reason = 'invalid';
    else {
      const current = {...this.#identity, sourceVersion: this.#sourceVersion,
        sourceRevision: this.#sourceRevision, designRevision: this.#designRevision};
      if (this.#missing || identityFields.some(field => token[field] !== current[field])) reason = 'stale';
      else {
        const entry = this.#pending.get(token.id);
        if (!entry) reason = 'expired';
        else if (tokenFields.some(field => token[field] !== entry.token[field])) reason = 'invalid';
        else if (checkSignal && entry.signal?.aborted) reason = 'cancelled';
      }
    }
    return reason && {accepted: false, reason, state: this.state,
      diagnostic: makeDiagnostic('SFSYNC_' + reason.toUpperCase(), `Synchronization token is ${reason}.`)};
  }

  #ensureActive() {
    if (this.#disposed) fail('SFSYNC_DISPOSED', 'Synchronization protocol is disposed.');
  }

  #changed(origin) {
    this.#diagnostic = null;
    this.#origin = origin;
    this.#clearPending();
  }

  #release(id) {
    const entry = this.#pending.get(id);
    if (!entry) return;
    entry.signal?.removeEventListener('abort', entry.abort);
    this.#pending.delete(id);
  }

  #clearPending() {
    for (const id of this.#pending.keys()) this.#release(id);
  }
}
