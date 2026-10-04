import {DrawOp} from '../drawing/commands.js';
import {IDENTITY, multiply} from '../media/transforms.js';
import {analyticInstance} from './analytic-instances.js';
import {DeltaUpload} from './delta-upload.js';

function equal(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
}

function sourceEntries(list) {
  const result = [];
  const stack = [];
  const clear = [];
  let transform = IDENTITY;
  for (const command of list.commands) {
    if (command.op === DrawOp.PushTransform) { stack.push(transform); transform = multiply(transform, command.transform); continue; }
    if (command.op === DrawOp.Pop) { if (!stack.length) return null; transform = stack.pop(); continue; }
    if (command.op === DrawOp.Clear) { clear.push(command); continue; }
    if (![DrawOp.Rectangle, DrawOp.RoundedRectangle, DrawOp.Ellipse].includes(command.op)) return null;
    if (command.rect[2] && command.rect[3]) result.push({command, transform});
  }
  return stack.length ? null : {entries: result, clear};
}

const handleKey = handle => handle.session + ':' + handle.id + ':' + handle.generation;

/** Patches retained analytic batches in place; unsupported topology returns false for a complete plan rebuild. */
export class AnalyticInstanceUpdates {
  static create(plan, list, resources) {
    if (!plan.root.commands.every(command => command.kind === 'clear' || command.kind === 'draw' && command.mesh.kind === 'analytic')) return null;
    const source = sourceEntries(list);
    const meshes = plan.root.commands.filter(command => command.kind === 'draw').map(command => command.mesh);
    if (!source || meshes.reduce((count, mesh) => count + mesh.count, 0) !== source.entries.length) return null;
    return new AnalyticInstanceUpdates(plan, list, resources, {source, meshes});
  }
  constructor(plan, list, resources, {source, meshes}) {
    this.plan = plan;
    this.list = list;
    this.resources = resources;
    this.entries = source.entries;
    this.clear = source.clear;
    this.dependencies = new Map();
    this.dirty = new Set();
    this.options = {...plan.options, instanceData: new Float32Array(32)};
    this.lastUpload = {uploadedBytes: 0, ranges: 0, changedInstances: 0};
    this.batches = [];
    let row = 0;
    for (const mesh of meshes) {
      const upload = new DeltaUpload({capacity: mesh.count, stride: 128});
      upload.bytes.set(new Uint8Array(mesh.data.buffer, mesh.data.byteOffset, mesh.data.byteLength));
      upload.count = mesh.count;
      const batch = {mesh, upload};
      this.batches.push(batch);
      for (let index = 0; index < mesh.count; index++) Object.assign(this.entries[row++], {batch, index});
    }
    this.indexDependencies();
    this.unsubscribe = resources?.subscribe?.(event => {
      for (const row of this.dependencies.get(handleKey(event.handle)) ?? []) this.dirty.add(row);
    });
    this.revision = resources?.version ?? 0;
    this.closed = false;
  }

  indexDependencies() {
    this.dependencies.clear();
    const visit = (value, row, visited, depth) => {
      if (!value || typeof value !== 'object' || depth > 16) return;
      if (value.session && Number.isSafeInteger(value.id) && Number.isSafeInteger(value.generation)) {
        const key = handleKey(value);
        if (visited.has(key)) return;
        visited.add(key);
        const rows = this.dependencies.get(key) ?? new Set();
        rows.add(row);
        this.dependencies.set(key, rows);
        visit(this.resources.resolve(value), row, visited, depth + 1);
      } else for (const child of Object.values(value)) visit(child, row, visited, depth + 1);
    };
    for (let row = 0; row < this.entries.length; row++) visit(this.entries[row].command, row, new Set(), 0);
  }

  update(list, resources) {
    if (this.closed || resources !== this.resources) return false;
    let source = null;
    if (list !== this.list) {
      source = sourceEntries(list);
      if (!source || source.entries.length !== this.entries.length || !equal(source.clear, this.clear)) return false;
      for (let row = 0; row < this.entries.length; row++) {
        const previous = this.entries[row], next = source.entries[row];
        if (previous.command.op !== next.command.op) return false;
        if (!equal(previous.command, next.command) || !equal(previous.transform, next.transform)) this.dirty.add(row);
      }
    }
    if (!this.unsubscribe && resources?.version !== this.revision) {
      for (let row = 0; row < this.entries.length; row++) this.dirty.add(row);
    }
    this.lastUpload.uploadedBytes = this.lastUpload.ranges = this.lastUpload.changedInstances = 0;
    for (const row of this.dirty) {
      const previous = this.entries[row], next = source?.entries[row] ?? previous;
      const instance = analyticInstance(next.command, next.transform, resources, this.options, previous.batch.mesh.texture);
      if (!instance || instance.count !== 1) return false;
      if (previous.batch.upload.set(previous.index, instance.data)) this.lastUpload.changedInstances++;
    }
    for (const batch of this.batches) {
      const result = batch.upload.flush(this.plan.backend.device.queue, batch.mesh.buffer);
      this.lastUpload.uploadedBytes += result.uploadedBytes;
      this.lastUpload.ranges += result.ranges;
    }
    if (source) {
      for (let row = 0; row < this.entries.length; row++) Object.assign(this.entries[row], source.entries[row]);
      this.indexDependencies();
    }
    this.list = list;
    this.revision = resources?.version ?? 0;
    this.dirty.clear();
    return true;
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe?.();
    for (const batch of this.batches) batch.upload.dispose();
    this.dependencies.clear();
    this.dirty.clear();
  }
}
