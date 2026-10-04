import {ProviderDiskWorkspace as DiskWorkspace, encodeWorkspaceFile} from '@sharpforge/project-system';
import {hashFileBytes} from '@sharpforge/workspace';

function assertCurrent(host, context, payload) {
  const current = host.context();
  if (current.identity !== context.identity || payload.revision !== undefined && current.revision !== payload.revision) {
    throw new Error('Workspace changed before the disk update could be applied');
  }
  if (current.readOnly) throw new Error('Stop execution before applying external disk changes');
  const record = current.records.find(file => file.path === payload.path);
  if (payload.expectedVersion !== undefined && (record?.version ?? 0) !== payload.expectedVersion) {
    throw new Error('Document changed after the disk reload decision: ' + payload.path);
  }
}

/** Adopt the exact observed bytes only after the controller's reload decision and the current version both agree. */
export async function applyExternalDiskChange(host, session, payload) {
  const context = host.context();
  const disk = context.disk;
  if (!disk) throw new Error('The watched folder is no longer attached');
  assertCurrent(host, context, payload);
  const {record, event = {}} = payload;
  const oldPath = event.oldPath ?? payload.path;
  const path = record?.path ?? event.path ?? payload.path;
  const hash = record && !record.lazy ? record.hash ?? event.hash ?? await hashFileBytes(encodeWorkspaceFile(record)) : null;
  if (host.context().revision !== context.revision) throw new Error('Workspace changed while preparing the disk update');
  assertCurrent(host, context, payload);
  const records = context.records.filter(file => file.path !== oldPath && file.path !== path);
  if (record) records.push({...record, version: (context.records.find(file => file.path === oldPath)?.version ?? 0) + 1});
  const dirty = context.dirty.filter(file => file !== oldPath && file !== path);
  const mappings = oldPath && path && oldPath !== path ? [{from: oldPath, to: path}] : [];
  await session.commit({records, folders: context.folders, mappings, dirty, diskCommitted: true,
    persistedPaths: record ? [path] : [], preserveMembership: true});
  if (host.context().disk !== disk) throw new Error('The watched folder changed while applying its update');
  const physical = disk.records.filter(file => file.path !== oldPath && file.path !== path);
  if (record) physical.push(record);
  disk.adoptRecords(physical, {folders: context.folders, preserveBaselines: true});
  disk.baselineHashes.delete(oldPath);
  if (hash) disk.baselineHashes.set(path, hash);
  return {path, applied: true, reevaluated: true};
}

/** A rescan replaces membership coherently while retaining every unsaved editor's previous bytes and version. */
export async function reevaluateDiskWorkspace(host, session, payload) {
  const context = host.context();
  assertCurrent(host, context, payload);
  if (!payload.rescan && (payload.record || ['deleted', 'renamed'].includes(payload.event?.type))) {
    return applyExternalDiskChange(host, session, payload);
  }
  if (!payload.rescan) {
    await session.commit({records: context.records, folders: context.folders, dirty: context.dirty,
      diskCommitted: true, preserveMembership: true});
    return {reevaluated: true};
  }
  const previous = new Map(context.records.map(record => [record.path, record]));
  const dirty = new Set(context.dirty);
  const baselines = new Map([...dirty].map(path => [path, context.disk.baselineHashes.get(path)]));
  const present = new Set(payload.records.map(record => record.path));
  const records = payload.records.map(record => dirty.has(record.path) && previous.has(record.path) ? previous.get(record.path) : record);
  for (const path of dirty) if (!present.has(path) && previous.has(path)) records.push(previous.get(path));
  const staged = new DiskWorkspace([], new Map(), context.name, [], [],
    {...context.disk.options, rootHandle: context.disk.rootHandle, provider: context.disk.provider});
  staged.adoptRecords(payload.records, {folders: payload.folders, report: payload.report, preserveBaselines: false});
  await session.commit({records, folders: payload.folders, dirty: [...dirty], diskSnapshot: staged,
    diskCommitted: true, preserveMembership: true});
  if (host.context().disk !== context.disk) throw new Error('The watched folder changed during rescan');
  context.disk.adoptRecords(staged.records, {folders: payload.folders, report: payload.report, preserveBaselines: true});
  for (const [path, hash] of staged.baselineHashes) if (!dirty.has(path)) context.disk.baselineHashes.set(path, hash);
  for (const [path, hash] of baselines) if (hash !== undefined) context.disk.baselineHashes.set(path, hash);
  return {reevaluated: true, files: records.length};
}
