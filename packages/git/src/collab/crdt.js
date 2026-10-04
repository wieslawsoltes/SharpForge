import { SourceText } from '@sharpforge/text';
import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { OrderIndex, ChildIndex } from './order-index.js';
import {
  COLLAB_PROTOCOL_VERSION, collaborationLimits, validateIdentityPart, validateUpdate,
  validateAnchor, parseAtomId, compareAtoms, sameDocument
} from './validation.js';
import { encodeJson, validateSnapshotHeader } from './encoding.js';

/** RGA sequence with causal Lamport IDs and AVL indices. Offsets count UTF-16 units. */
export class SequenceCrdt {
  #index = new OrderIndex();
  #atoms = new Map();
  #pending = new Map();
  #deleted = new Set();
  #updates = new Map();
  #history = [];
  #reserved = new Map();
  #listeners = new Set();
  #pendingCount = 0;
  #clock = 0;
  #revision = 0;
  #epoch = 0;
  #historyBytes = 0;
  #text = '';
  #disposed = false;
  #head;

  constructor({ actorId, workspaceId, documentId, limits } = {}) {
    this.actorId = validateIdentityPart(actorId, 'CRDT actor');
    this.workspaceId = validateIdentityPart(workspaceId, 'Workspace');
    this.documentId = validateIdentityPart(documentId, 'Document');
    this.limits = collaborationLimits(limits);
    this.#head = { children: new ChildIndex(compareAtoms), end: this.#index.createMarker() };
    this.#index.insertBefore(null, this.#head.end);
    Object.freeze(this);
  }

  get length() {
    return this.#index.length;
  }

  get revision() {
    return this.#revision;
  }

  get text() {
    this.#assertOpen();
    if (this.#text === null) this.#text = [...this.#index.range()].map(atom => atom.value).join('');
    return this.#text;
  }

  get stats() {
    return Object.freeze({
      nodes: this.#atoms.size, pendingNodes: this.#pendingCount, operations: this.#updates.size,
      historyBytes: this.#historyBytes, indexHeight: this.#index.root?.height ?? 0
    });
  }

  /** Subscribe to applied transactions; changes use sequential coordinates within that transaction. */
  subscribe(listener) {
    this.#assertOpen();
    if (typeof listener !== 'function') throw new TypeError('A CRDT listener must be a function');
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  insert(offset, text) {
    return this.replace(offset, 0, text);
  }

  delete(offset, count) {
    return this.replace(offset, count, '');
  }

  /** Replace visible text atomically; returned immutable update is safe for transport or persistence. */
  replace(offset, deleteCount, text) {
    this.#assertOpen();
    checkLimit(offset, this.length, 'CRDT offset');
    checkLimit(deleteCount, this.length - offset, 'CRDT deletion length');
    if (typeof text !== 'string') throw new GitError('Corrupt', 'Inserted CRDT text must be a string');
    checkLimit(deleteCount + text.length, this.limits.maxUpdateUnits, 'CRDT edit units');
    if (!deleteCount && !text.length) return null;
    const clock = this.#clock + 1;
    checkLimit(clock + Math.max(text.length - 1, 0), Number.MAX_SAFE_INTEGER, 'CRDT Lamport clock');
    const deletes = [...this.#index.range(offset, deleteCount)].map(atom => atom.id);
    const inserts = [];
    let parent = offset ? this.#index.at(offset - 1).atom.id : null;
    for (let index = 0; index < text.length; index++) {
      const id = this.actorId + ':' + (clock + index);
      inserts.push({ id, parent, value: text[index] });
      parent = id;
    }
    const update = validateUpdate({
      type: 'update', version: COLLAB_PROTOCOL_VERSION, id: this.actorId + ':' + clock,
      actorId: this.actorId, workspaceId: this.workspaceId, documentId: this.documentId, inserts, deletes
    }, this.limits);
    this.apply(update, { local: true });
    return update;
  }

  /** Validate before mutation; duplicates are no-ops and identity collisions are explicit conflicts. */
  prepareUpdate(input) {
    this.#assertOpen();
    const update = validateUpdate(input, this.limits);
    if (!sameDocument(this, update)) throw new GitError('Auth', 'Collaboration update belongs to another workspace or document');
    const serialized = JSON.stringify(update);
    const existing = this.#updates.get(update.id);
    if (existing) {
      if (JSON.stringify(existing) !== serialized) throw new GitError('Conflict', 'CRDT operation ID was reused with different content');
      return Object.freeze({ update: existing, byteLength: 0, duplicate: true });
    }
    const bytes = encodeJson(update, this.limits.maxUpdateBytes).byteLength;
    this.#preflight(update, bytes);
    return Object.freeze({ update, byteLength: bytes, duplicate: false });
  }

  apply(input, { local = false, notify = true } = {}) {
    const prepared = this.prepareUpdate(input);
    if (prepared.duplicate) return false;
    const { update, byteLength: bytes } = prepared;
    const changes = [];
    this.#updates.set(update.id, update);
    this.#history.push(update);
    this.#historyBytes += bytes;
    this.#reserved.set(update.id, update.id);
    for (const entry of update.inserts) {
      this.#reserved.set(entry.id, update.id);
      this.#addAtom(entry, changes);
    }
    for (const id of update.deletes) this.#deleteAtom(id, changes);
    const operation = parseAtomId(update.id);
    this.#clock = Math.max(this.#clock, operation.clock + Math.max(update.inserts.length - 1, 0));
    this.#revision++;
    if (changes.length) this.#text = null;
    if (notify) this.#emit({ type: 'change', local, update, changes, revision: this.#revision });
    return true;
  }

  #preflight(update, bytes) {
    checkLimit(this.#updates.size + 1, this.limits.maxOperations, 'CRDT history operations');
    checkLimit(this.#atoms.size + update.inserts.length, this.limits.maxNodes, 'CRDT atom count');
    checkLimit(this.#historyBytes + bytes, this.limits.maxHistoryBytes, 'CRDT history bytes');
    const first = update.inserts[0];
    const waiting = first && first.parent !== null && !this.#atoms.get(first.parent)?.attached;
    checkLimit(this.#pendingCount + (waiting ? update.inserts.length : 0), this.limits.maxPendingNodes, 'CRDT pending atoms');
    let newDeleted = 0;
    for (const id of update.deletes) if (!this.#deleted.has(id)) newDeleted++;
    checkLimit(this.#deleted.size + newDeleted, this.limits.maxNodes, 'CRDT tombstones');
    for (const id of [update.id, ...update.inserts.map(entry => entry.id)]) {
      if (this.#reserved.has(id)) throw new GitError('Conflict', 'CRDT actor clock range was reused');
    }
  }

  #addAtom(entry, changes) {
    const parsed = parseAtomId(entry.id);
    const atom = {
      ...entry, ...parsed, attached: false, pending: false, children: new ChildIndex(compareAtoms), start: null, end: null
    };
    this.#atoms.set(atom.id, atom);
    const parent = atom.parent === null ? this.#head : this.#atoms.get(atom.parent);
    if (parent && (parent === this.#head || parent.attached)) this.#attach(atom, changes);
    else {
      const list = this.#pending.get(atom.parent) ?? [];
      list.push(atom);
      this.#pending.set(atom.parent, list);
      atom.pending = true;
      this.#pendingCount++;
    }
  }

  #attach(first, changes) {
    const queue = [first];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const atom = queue[cursor];
      const parent = atom.parent === null ? this.#head : this.#atoms.get(atom.parent);
      const following = parent.children.after(atom);
      const reference = following?.start ?? parent.end;
      atom.start = this.#index.createMarker(atom, this.#deleted.has(atom.id) ? 0 : 1);
      atom.end = this.#index.createMarker(atom);
      this.#index.insertBefore(reference, atom.start);
      this.#index.insertBefore(reference, atom.end);
      parent.children.insert(atom);
      atom.attached = true;
      if (atom.pending) this.#pendingCount--;
      if (atom.start.weight) appendChange(changes, this.#index.offsetOf(atom.start), 0, atom.value);
      const children = this.#pending.get(atom.id);
      if (children) {
        for (const child of children) queue.push(child);
        this.#pending.delete(atom.id);
      }
    }
  }

  #deleteAtom(id, changes) {
    this.#deleted.add(id);
    const atom = this.#atoms.get(id);
    if (atom?.attached && atom.start.weight) {
      appendChange(changes, this.#index.offsetOf(atom.start), 1, '');
      this.#index.setWeight(atom.start, 0);
    }
  }

  /** Anchors survive inserts and tombstones; unresolved remote IDs return null until delivered. */
  anchorAt(offset, bias = 'right') {
    this.#assertOpen();
    checkLimit(offset, this.length, 'CRDT anchor offset');
    return validateAnchor({
      left: offset ? this.#index.at(offset - 1).atom.id : null,
      right: offset < this.length ? this.#index.at(offset).atom.id : null, bias
    });
  }

  resolveAnchor(input) {
    this.#assertOpen();
    const anchor = validateAnchor(input);
    const left = anchor.left === null ? null : this.#atoms.get(anchor.left);
    const right = anchor.right === null ? null : this.#atoms.get(anchor.right);
    if (anchor.left !== null && !left?.attached || anchor.right !== null && !right?.attached) return null;
    if (anchor.bias === 'left') return left ? this.#index.offsetOf(left.start) + left.start.weight : 0;
    return right ? this.#index.offsetOf(right.start) : this.length;
  }

  toSourceText(uri = this.documentId) {
    return new SourceText(this.text, uri, this.#revision + 1);
  }

  updatesByActor(actorId = this.actorId) {
    this.#assertOpen();
    return [...this.#updates.values()].filter(update => update.actorId === actorId);
  }

  snapshot() {
    this.#assertOpen();
    const updates = [...this.#updates.values()].sort((left, right) => {
      const a = parseAtomId(left.id);
      const b = parseAtomId(right.id);
      return a.clock - b.clock || (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : 0);
    });
    return Object.freeze({
      type: 'snapshot', version: COLLAB_PROTOCOL_VERSION, workspaceId: this.workspaceId, documentId: this.documentId,
      updates: Object.freeze(updates)
    });
  }

  static fromSnapshot(snapshot, options) {
    const result = new SequenceCrdt({ ...snapshot, ...options });
    validateSnapshotHeader(snapshot, result.limits);
    if (!sameDocument(result, snapshot)) throw new GitError('Auth', 'Snapshot belongs to another document');
    encodeJson(snapshot, result.limits.maxSnapshotBytes);
    for (const update of snapshot.updates) result.apply(update, { notify: false });
    return result;
  }

  /** Stage and validate a full union before publishing it. Yielding keeps initial sync cancellable. */
  async mergeSnapshot(snapshot, { signal, yieldEvery = 256, yieldTask = yieldToHost } = {}) {
    this.#assertOpen();
    validateSnapshotHeader(snapshot, this.limits);
    if (!sameDocument(this, snapshot)) throw new GitError('Auth', 'Snapshot belongs to another document');
    encodeJson(snapshot, this.limits.maxSnapshotBytes);
    checkLimit(yieldEvery, 65_536, 'Snapshot batch size');
    if (!yieldEvery) throw new GitError('Limit', 'Snapshot batch size must be positive');
    const epoch = this.#epoch;
    const historyLength = this.#history.length;
    const staged = new SequenceCrdt(this);
    let count = 0;
    for (const source of [this.#updates.values(), snapshot.updates]) {
      for (const update of source) {
        checkCancelled(signal);
        staged.apply(update, { notify: false });
        if (++count % yieldEvery === 0) await yieldTask();
      }
    }
    checkCancelled(signal);
    this.#assertOpen();
    if (epoch !== this.#epoch) throw new GitError('Conflict', 'Another collaboration snapshot was committed during staging');
    for (let index = historyLength; index < this.#history.length; index++) staged.apply(this.#history[index], { notify: false });
    const oldLength = this.length;
    this.#index = staged.#index;
    this.#atoms = staged.#atoms;
    this.#pending = staged.#pending;
    this.#deleted = staged.#deleted;
    this.#updates = staged.#updates;
    this.#history = staged.#history;
    this.#reserved = staged.#reserved;
    this.#head = staged.#head;
    this.#clock = staged.#clock;
    this.#pendingCount = staged.#pendingCount;
    this.#historyBytes = staged.#historyBytes;
    this.#revision++;
    this.#epoch++;
    this.#text = null;
    this.#emit({ type: 'snapshot', local: false, revision: this.#revision, changes: [{ start: 0, deleteCount: oldLength, insertText: this.text }] });
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#listeners.clear();
    this.#atoms.clear();
    this.#pending.clear();
    this.#updates.clear();
    this.#history = [];
    this.#reserved.clear();
    this.#deleted.clear();
    this.#index = new OrderIndex();
    this.#text = '';
  }

  #assertOpen() {
    if (this.#disposed) throw new GitError('Disposed', 'Collaboration document is disposed');
  }

  #emit(event) {
    for (const listener of this.#listeners) listener(event);
  }
}

function appendChange(changes, start, deleteCount, insertText) {
  const previous = changes.at(-1);
  if (previous && !deleteCount && !previous.deleteCount && start === previous.start + previous.insertText.length) {
    previous.insertText += insertText;
  } else if (previous && !insertText && !previous.insertText && start === previous.start) {
    previous.deleteCount += deleteCount;
  } else changes.push({ start, deleteCount, insertText });
}

function yieldToHost() {
  return new Promise(resolve => setTimeout(resolve, 0));
}
