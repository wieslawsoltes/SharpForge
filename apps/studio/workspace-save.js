import {decodeWorkspaceFile, recordSource} from '@sharpforge/project-system';
import {hashFileBytes, hashWorkspaceRecord, reconcileWorkspaceFile, workspaceRecordBytes} from '@sharpforge/workspace';
import {
  workspaceSaveScope, workspaceSaveInputs, sameSaveRecord, saveRecordChange, replaceSaveRecord, savedWorkspaceCaptures
} from './workspace-save-scope.js';

async function diskSnapshot(disk, path, signal) {
  try {
    const bytes = await disk.provider.readFile(path, {signal});
    return {bytes, hash: await hashFileBytes(bytes, {signal}), record: decodeWorkspaceFile(path, bytes)};
  } catch (error) {
    if (error.code !== 'NotFound') throw error;
    return {bytes: null, hash: null, record: null};
  }
}

function content(record) {
  const source = recordSource(record);
  return source ? source.getText(0, source.length) : record ? typeof record.text === 'string' ? record.text : record.bytes : null;
}

function conflict(path, message) {
  const error = new Error('SFW1411: ' + message + ': ' + path);
  Object.assign(error, {name: 'WorkspaceSaveConflict', code: 'SFW1411', path});
  return error;
}

function currentSnapshot(host, context) {
  host.checkSave?.();
  if ((host.saveDisk ?? host.state.disk) !== context.disk || host.state.readOnly) {
    throw new Error('Workspace changed while saving; current buffers were preserved');
  }
  const current = host.context();
  if (current.identity !== context.identity || current.disk !== context.disk || current.readOnly) {
    throw new Error('Workspace changed while saving; current buffers were preserved');
  }
  return {context: current, records: new Map(current.records.map(record => [record.path, record]))};
}

function assertSnapshot(host, snapshot) {
  host.checkSave?.();
  const current = host.context();
  if (current.identity !== snapshot.context.identity || current.disk !== snapshot.context.disk ||
      current.revision !== snapshot.context.revision || current.readOnly) {
    throw new Error('Workspace changed while saving; current buffers were preserved');
  }
  const records = new Map(current.records.map(record => [record.path, record]));
  if (records.size !== snapshot.context.records.length || snapshot.context.records.some(previous => {
    const record = records.get(previous.path);
    return !sameSaveRecord(record, previous);
  })) throw new Error('Workspace buffers changed while saving; current edits were preserved');
}

async function matchesInput(snapshot, input, signal) {
  const record = snapshot.records.get(input.path);
  if (!record || input.version !== undefined && input.version !== record.version) return false;
  return await hashWorkspaceRecord(record, {signal}) === input.hash;
}

/** Resolve every pre-existing conflict before the first effect; selected remote hashes remain save preconditions. */
async function prepareSave(host, context, inputs, {signal, maxConflicts, captures}) {
  const pending = [];
  const resolutions = [];
  let prompts = 0;
  for (const input of inputs) {
    signal?.throwIfAborted();
    const remote = await diskSnapshot(context.disk, input.path, signal);
    if (remote.hash === input.expectedHash) {
      pending.push(saveRecordChange(input.record, input.expectedHash));
      continue;
    }
    if (!host.chooseSaveConflict) throw conflict(input.path, 'Disk conflict requires an explicit keep-mine, take-theirs or merge choice');
    if (++prompts > maxConflicts) throw new RangeError('Too many save conflicts; resolve at most ' + maxConflicts + ' at once');
    const physical = context.disk.record(input.path);
    const base = physical && !physical.lazy && await hashWorkspaceRecord(physical, {signal}) === input.expectedHash ? content(physical) : undefined;
    const choice = await host.chooseSaveConflict({path: input.path, base, mine: content(input.record), signal,
      theirs: content(remote.record), expectedHash: input.expectedHash, actualHash: remote.hash,
      choices: ['keep-mine', 'take-theirs', 'merge']});
    if (!choice) return {cancelled: true, pending: [], resolutions: []};
    if (!['keep-mine', 'take-theirs', 'merge'].includes(choice)) throw new TypeError('Choose keep-mine, take-theirs or merge');
    if (!await matchesInput(currentSnapshot(host, context), input, signal)) {
      throw conflict(input.path, 'Editor changed while choosing a save resolution');
    }
    signal?.throwIfAborted();
    const result = reconcileWorkspaceFile({path: input.path, base, mine: content(input.record),
      theirs: content(remote.record), choice}, {signal});
    if (result.status === 'conflict') throw conflict(input.path, result.message ?? 'Text edits overlap; choose one version or merge manually');
    const replacement = typeof result.content === 'string' ? {path: input.path, text: result.content}
      : {path: input.path, bytes: result.content};
    const record = choice === 'take-theirs' ? remote.record : replaceSaveRecord(input.record, replacement, (input.version ?? 0) + 1);
    const bytes = record ? workspaceRecordBytes(record).slice() : null;
    const hash = bytes === null ? null : await hashFileBytes(bytes, {signal});
    resolutions.push({input, choice, record, bytes, hash, observedHash: remote.hash});
    if (choice !== 'take-theirs') pending.push({path: input.path, bytes, expectedHash: remote.hash});
  }
  const latest = currentSnapshot(host, context);
  for (const input of inputs) {
    if (captures && !resolutions.some(resolution => resolution.input === input)) continue;
    if (!await matchesInput(latest, input, signal)) throw conflict(input.path, 'Editor changed before saving');
  }
  assertSnapshot(host, latest);
  for (const resolution of resolutions) {
    const current = await diskSnapshot(context.disk, resolution.input.path, signal);
    if (current.hash !== resolution.observedHash) throw conflict(resolution.input.path, 'Disk changed after the save choice');
  }
  return {pending, inputs, resolutions, cancelled: false};
}

async function finishSave(host, commit, {context, plan, report, signal}) {
  const {disk} = context;
  const latest = currentSnapshot(host, context);
  const {records} = latest;
  const dirty = new Set(latest.context.dirty ?? []);
  const physical = new Map(disk.records.map(record => [record.path, record]));
  const applied = [];
  const retained = new Set();
  const retryBaselines = [];
  for (const resolution of plan.resolutions) {
    const {input, record, choice, hash} = resolution;
    const current = await diskSnapshot(disk, input.path, signal);
    if (current.hash !== hash) throw conflict(input.path, 'Disk changed again after the save resolution');
    if (!await matchesInput(latest, input, signal)) {
      retained.add(input.path);
      dirty.add(input.path);
      // A newer buffer may not include the remote edits that were merged. Its next save must ask again.
      retryBaselines.push(input);
      continue;
    }
    if (choice === 'take-theirs' || choice === 'merge') {
      if (record) records.set(input.path, replaceSaveRecord(records.get(input.path), record, (input.version ?? 0) + 1));
      else records.delete(input.path);
      applied.push(resolution);
    }
    dirty.delete(input.path);
  }
  const planned = new Map();
  for (const change of plan.pending) planned.set(change.path, await hashWorkspaceRecord(change, {signal}));
  const hashes = new Map();
  for (const path of report.written) {
    const record = records.get(path);
    const hash = record && await hashWorkspaceRecord(record, {signal});
    hashes.set(path, hash);
    if (record && hash === planned.get(path) && !retained.has(path)) dirty.delete(path);
    else if (record) { dirty.add(path); retained.add(path); }
  }
  for (const path of dirty) {
    const record = records.get(path);
    if (!record || retained.has(path) || record.lazy && !recordSource(record)) continue;
    const hash = hashes.get(path) ?? await hashWorkspaceRecord(record, {signal});
    if (hash === disk.baselineHashes.get(path)) dirty.delete(path);
  }
  assertSnapshot(host, latest);
  return completeSave(host, commit, {context, latest, plan, report, signal, applied, physical, dirty, retained, retryBaselines});
}

async function completeSave(host, commit, {context, latest, plan, report, signal, applied, physical, dirty, retained, retryBaselines}) {
  const {disk} = context;
  const {records} = latest;
  let committedFailure;
  if (applied.length) {
    const changedPaths = new Set(applied.map(item => item.input.path));
    const documentStates = latest.context.documentStates && new Map([...latest.context.documentStates]
      .filter(([path]) => records.has(path) && !changedPaths.has(path)));
    try {
      await commit({records: [...records.values()], folders: latest.context.folders, dirty: [...dirty], documentStates,
        entry: records.has(latest.context.entry) ? latest.context.entry : null,
        diskCommitted: true, persistedPaths: report.written, preserveMembership: true, signal});
    } catch (error) {
      if (!error.committed) throw error;
      committedFailure = error;
    }
    for (const resolution of applied.filter(item => item.choice === 'take-theirs')) {
      const path = resolution.input.path;
      if (resolution.record) physical.set(path, resolution.record);
      else physical.delete(path);
    }
    disk.adoptRecords([...physical.values()], {folders: disk.folders});
    for (const resolution of applied) {
      if (resolution.record) disk.baselineHashes.set(resolution.input.path, resolution.hash);
      else disk.baselineHashes.delete(resolution.input.path);
    }
  } else {
    reconcileSavedDocuments(host, latest, plan, report, dirty, retained);
    host.state.dirtyFiles = dirty;
  }
  for (const input of retryBaselines) disk.baselineHashes.set(input.path, input.expectedHash);
  try {
    host.saveLocal();
    host.renderWorkspace();
    host.renderProject();
  } catch (error) {
    error.committed = true;
    if (committedFailure) {
      const combined = new AggregateError([committedFailure, error], 'Saved workspace notifications failed');
      combined.committed = true;
      throw combined;
    }
    throw error;
  }
  if (committedFailure) throw committedFailure;
  return {...report, committed: applied.length > 0, acknowledged: host.acknowledged ?? report.written,
    adopted: applied.filter(item => item.choice === 'take-theirs').map(item => item.input.path), retained: [...retained]};
}

function reconcileSavedDocuments(host, latest, plan, report, dirty, retained) {
  if (!host.documents || host.reconcileDocuments === false) return;
  const inputs = new Map((plan.inputs ?? []).map(input => [input.path, input.record]));
  const resolved = new Set(plan.resolutions.map(item => item.input.path));
  const candidates = new Set([...report.written, ...(latest.context.dirty ?? []).filter(path => !dirty.has(path))]);
  for (const path of candidates) {
    if (!host.documents.get(path) || retained.has(path) && resolved.has(path)) continue;
    host.checkSave?.();
    const saved = inputs.get(path) ?? latest.records.get(path);
    const source = recordSource(saved);
    try {
      host.documents.markSaved(path, source ? {source, version: source.version} : {text: saved.text, version: saved.version});
    } catch (error) {
      error.committed = true;
      throw error;
    }
  }
}

/** Save text/XML/binary snapshots with explicit reconciliation and exact hash admission. Partial receipts preserve dirty buffers. */
export function createWorkspaceSave(host, commit) {
  let saving = false;
  return async function save(options = {}) {
    const {signal, maxConflicts = 32} = options;
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(maxConflicts) || maxConflicts < 1 || maxConflicts > 256) {
      throw new RangeError('Save conflict limit must be an integer between 1 and 256');
    }
    if (saving) throw new Error('A workspace save is already in progress');
    if (host.state.nativeMode) return host.nativeBuild.save();
    if (host.state.readOnly) throw new Error('This workspace is read-only');
    const scoped = workspaceSaveScope(host, options);
    const disk = scoped.saveDisk;
    if (!disk || !disk.rootHandle && !disk.handles.size) throw new Error('Open a writable folder or save the workspace to a new folder');
    const starting = scoped.context();
    saving = host.state.saveBusy = true;
    let report = {written: [], hashes: [], atomic: false};
    let plan;
    try {
      await host.persistenceReady();
      signal?.throwIfAborted();
      const context = currentSnapshot(scoped, starting).context;
      const inputs = await workspaceSaveInputs(context, options);
      if (!inputs.length) {
        const result = await finishSave(scoped, commit, {context, plan: {pending: [], inputs, resolutions: []}, report, signal});
        host.toast('No modified files to save.');
        return result;
      }
      plan = await prepareSave(scoped, context, inputs, {...options, maxConflicts});
      if (plan.cancelled) return {...report, cancelled: true};
      currentSnapshot(scoped, context);
      report = await disk.save(plan.pending, {signal, check: scoped.checkSave});
      const finish = () => finishSave(scoped, commit, {context, plan, report, signal});
      const result = plan.resolutions.length && disk.saveLocks ? await disk.saveLocks.run('', finish, {signal, workspace: true}) : await finish();
      host.log(`Saved ${result.written.length} file(s); adopted ${result.adopted.length} disk version(s).`, 'success');
      host.toast(result.retained.length ? 'Saved the reviewed versions. Newer editor changes remain unsaved: ' + result.retained.join(', ')
        : 'Saved files and applied the selected conflict resolutions.');
      return result;
    } catch (error) {
      error.written ??= report.written;
      error.hashes ??= report.hashes;
      error.savedSnapshots = savedWorkspaceCaptures(plan, error.written);
      const written = new Set(error.written);
      for (const resolution of error.committed ? [] : plan?.resolutions ?? []) {
        if (written.has(resolution.input.path)) disk.baselineHashes.set(resolution.input.path, resolution.input.expectedHash);
      }
      if (error.written.length) host.toast('Save stopped after writing: ' + error.written.join(', ') + '. Unsaved buffers were retained.');
      throw error;
    } finally { saving = host.state.saveBusy = false; }
  };
}
