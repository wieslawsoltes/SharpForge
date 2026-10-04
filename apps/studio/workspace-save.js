import {decodeWorkspaceFile, encodeWorkspaceFile} from '@sharpforge/project-system';
import {hashFileBytes, reconcileWorkspaceFile} from '@sharpforge/workspace';

async function diskSnapshot(disk, path, signal) {
  try {
    const bytes = await disk.provider.readFile(path, {signal});
    return {bytes, hash: await hashFileBytes(bytes, {signal}), record: decodeWorkspaceFile(path, bytes)};
  } catch (error) {
    if (error.code !== 'NotFound') throw error;
    return {bytes: null, hash: null, record: null};
  }
}

function content(record) { return record ? typeof record.text === 'string' ? record.text : record.bytes : null; }

function conflict(path, message) {
  const error = new Error('SFW1411: ' + message + ': ' + path);
  Object.assign(error, {name: 'WorkspaceSaveConflict', code: 'SFW1411', path});
  return error;
}

function currentSnapshot(host, context) {
  if (host.state.disk !== context.disk || host.state.readOnly) {
    throw new Error('Workspace changed while saving; current buffers were preserved');
  }
  const current = host.context();
  if (current.identity !== context.identity || current.disk !== context.disk || current.readOnly) {
    throw new Error('Workspace changed while saving; current buffers were preserved');
  }
  return {context: current, records: new Map(current.records.map(record => [record.path, record]))};
}

function assertSnapshot(host, snapshot) {
  const current = host.context();
  if (current.identity !== snapshot.context.identity || current.disk !== snapshot.context.disk ||
      current.revision !== snapshot.context.revision || current.readOnly) {
    throw new Error('Workspace changed while saving; current buffers were preserved');
  }
  const records = new Map(current.records.map(record => [record.path, record]));
  if (records.size !== snapshot.context.records.length || snapshot.context.records.some(previous => {
    const record = records.get(previous.path);
    return !record || record.version !== previous.version || record.text !== previous.text || record.bytes !== previous.bytes;
  })) throw new Error('Workspace buffers changed while saving; current edits were preserved');
}

async function matchesInput(snapshot, input, signal) {
  const record = snapshot.records.get(input.path);
  if (!record || input.version !== undefined && input.version !== record.version) return false;
  return await hashFileBytes(encodeWorkspaceFile(record), {signal}) === input.hash;
}

async function saveInputs(context, signal) {
  const inputs = [];
  for (const record of context.records) {
    signal?.throwIfAborted();
    if (record.lazy && typeof record.text !== 'string') continue;
    const bytes = encodeWorkspaceFile(record).slice();
    const hash = await hashFileBytes(bytes, {signal});
    const baseline = context.disk.baselineHashes.get(record.path);
    if (baseline === hash) continue;
    const physical = context.disk.record(record.path);
    let base;
    if (physical && !physical.lazy && await hashFileBytes(encodeWorkspaceFile(physical), {signal}) === baseline) {
      base = content(physical);
    }
    inputs.push({path: record.path, bytes, hash, expectedHash: baseline ?? null, base,
      version: record.version, mine: decodeWorkspaceFile(record.path, bytes)});
  }
  return inputs;
}

/** Resolve every pre-existing conflict before the first effect; selected remote hashes remain save preconditions. */
async function prepareSave(host, context, inputs, {signal, maxConflicts}) {
  const pending = [];
  const resolutions = [];
  let prompts = 0;
  for (const input of inputs) {
    signal?.throwIfAborted();
    const remote = await diskSnapshot(context.disk, input.path, signal);
    if (remote.hash === input.expectedHash) {
      pending.push({path: input.path, bytes: input.bytes, expectedHash: input.expectedHash});
      continue;
    }
    if (!host.chooseSaveConflict) throw conflict(input.path, 'Disk conflict requires an explicit keep-mine, take-theirs or merge choice');
    if (++prompts > maxConflicts) throw new RangeError('Too many save conflicts; resolve at most ' + maxConflicts + ' at once');
    const choice = await host.chooseSaveConflict({path: input.path, base: input.base, mine: content(input.mine),
      theirs: content(remote.record), expectedHash: input.expectedHash, actualHash: remote.hash,
      choices: ['keep-mine', 'take-theirs', 'merge']});
    if (!choice) return {cancelled: true, pending: [], resolutions: []};
    if (!['keep-mine', 'take-theirs', 'merge'].includes(choice)) throw new TypeError('Choose keep-mine, take-theirs or merge');
    if (!await matchesInput(currentSnapshot(host, context), input, signal)) {
      throw conflict(input.path, 'Editor changed while choosing a save resolution');
    }
    const result = reconcileWorkspaceFile({path: input.path, base: input.base, mine: content(input.mine),
      theirs: content(remote.record), choice}, {signal});
    if (result.status === 'conflict') throw conflict(input.path, result.message ?? 'Text edits overlap; choose one version or merge manually');
    const record = choice === 'take-theirs' ? remote.record : typeof result.content === 'string'
      ? {...input.mine, text: result.content} : {...input.mine, bytes: result.content, text: undefined};
    const bytes = record ? encodeWorkspaceFile(record).slice() : null;
    const hash = bytes === null ? null : await hashFileBytes(bytes, {signal});
    resolutions.push({input, choice, record, bytes, hash, observedHash: remote.hash});
    if (choice !== 'take-theirs') pending.push({path: input.path, bytes, expectedHash: remote.hash});
  }
  const latest = currentSnapshot(host, context);
  for (const input of inputs) {
    if (!await matchesInput(latest, input, signal)) throw conflict(input.path, 'Editor changed before saving');
  }
  assertSnapshot(host, latest);
  for (const resolution of resolutions) {
    const current = await diskSnapshot(context.disk, resolution.input.path, signal);
    if (current.hash !== resolution.observedHash) throw conflict(resolution.input.path, 'Disk changed after the save choice');
  }
  return {pending, resolutions, cancelled: false};
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
      if (record) records.set(input.path, {...records.get(input.path), ...record, lazy: false, version: (input.version ?? 0) + 1});
      else records.delete(input.path);
      applied.push(resolution);
    }
    dirty.delete(input.path);
  }
  const planned = new Map(plan.pending.map(change => [change.path, change.bytes]));
  const hashes = new Map();
  for (const path of report.written) {
    const record = records.get(path);
    const hash = record && await hashFileBytes(encodeWorkspaceFile(record), {signal});
    hashes.set(path, hash);
    if (record && hash === await hashFileBytes(planned.get(path), {signal}) && !retained.has(path)) dirty.delete(path);
    else if (record) { dirty.add(path); retained.add(path); }
  }
  for (const path of dirty) {
    const record = records.get(path);
    if (!record || retained.has(path) || record.lazy && typeof record.text !== 'string') continue;
    const hash = hashes.get(path) ?? await hashFileBytes(encodeWorkspaceFile(record), {signal});
    if (hash === disk.baselineHashes.get(path)) dirty.delete(path);
  }
  assertSnapshot(host, latest);
  if (applied.length) {
    await commit({records: [...records.values()], folders: latest.context.folders, dirty: [...dirty],
      entry: records.has(latest.context.entry) ? latest.context.entry : null,
      diskCommitted: true, persistedPaths: report.written, preserveMembership: true});
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
  } else host.state.dirtyFiles = dirty;
  for (const input of retryBaselines) disk.baselineHashes.set(input.path, input.expectedHash);
  host.saveLocal();
  host.renderWorkspace();
  host.renderProject();
  return {...report, adopted: applied.filter(item => item.choice === 'take-theirs').map(item => item.input.path), retained: [...retained]};
}

/** Save text/XML/binary snapshots with explicit reconciliation and exact hash admission. Partial receipts preserve dirty buffers. */
export function createWorkspaceSave(host, commit) {
  let saving = false;
  return async function save({signal, maxConflicts = 32} = {}) {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(maxConflicts) || maxConflicts < 1 || maxConflicts > 256) {
      throw new RangeError('Save conflict limit must be an integer between 1 and 256');
    }
    if (saving) throw new Error('A workspace save is already in progress');
    if (host.state.nativeMode) return host.nativeBuild.save();
    if (host.state.readOnly) throw new Error('This workspace is read-only');
    const disk = host.state.disk;
    if (!disk || !disk.rootHandle && !disk.handles.size) throw new Error('Open a writable folder or save the workspace to a new folder');
    const starting = host.context();
    saving = host.state.saveBusy = true;
    let report = {written: [], hashes: [], atomic: false};
    let plan;
    try {
      await host.persistenceReady();
      signal?.throwIfAborted();
      const context = currentSnapshot(host, starting).context;
      const inputs = await saveInputs(context, signal);
      if (!inputs.length) {
        const result = await finishSave(host, commit, {context, plan: {pending: [], resolutions: []}, report, signal});
        host.toast('No modified files to save.');
        return result;
      }
      plan = await prepareSave(host, context, inputs, {signal, maxConflicts});
      if (plan.cancelled) return {...report, cancelled: true};
      currentSnapshot(host, context);
      report = await disk.save(plan.pending, {signal});
      const finish = () => finishSave(host, commit, {context, plan, report, signal});
      const result = plan.resolutions.length && disk.saveLocks ? await disk.saveLocks.run('', finish, {signal, workspace: true}) : await finish();
      host.log(`Saved ${result.written.length} file(s); adopted ${result.adopted.length} disk version(s).`, 'success');
      host.toast(result.retained.length ? 'Saved the reviewed versions. Newer editor changes remain unsaved: ' + result.retained.join(', ')
        : 'Saved files and applied the selected conflict resolutions.');
      return result;
    } catch (error) {
      error.written ??= report.written;
      error.hashes ??= report.hashes;
      const written = new Set(error.written);
      for (const resolution of plan?.resolutions ?? []) {
        if (written.has(resolution.input.path)) disk.baselineHashes.set(resolution.input.path, resolution.input.expectedHash);
      }
      if (error.written.length) host.toast('Save stopped after writing: ' + error.written.join(', ') + '. Unsaved buffers were retained.');
      throw error;
    } finally { saving = host.state.saveBusy = false; }
  };
}
