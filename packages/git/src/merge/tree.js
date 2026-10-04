import { GitIndex } from '../index-file.js';
import { checkCancelled } from '../errors.js';
import { treeDiff } from '../diff/tree.js';
import { mergeFile } from './diff3.js';

function same(left, right) {
  return left?.oid === right?.oid && left?.mode === right?.mode;
}

function conflict(result, path, base, ours, theirs, type) {
  result.index.remove(path);
  for (const [stage, entry] of [[1, base], [2, ours], [3, theirs]]) if (entry) result.index.set({ ...entry, path, stage });
  result.conflicts.push({ path, type, base: base?.oid ?? null, ours: ours?.oid ?? null, theirs: theirs?.oid ?? null });
}

function resolved(result, path, entry) {
  if (!entry) return;
  const normalized = { ...entry, path, stage: 0 };
  result.index.set(normalized);
  result.tree.set(path, normalized);
}

function conflictPath(result, path, ours, options) {
  const label = (ours ? options.oursLabel ?? 'HEAD' : options.theirsLabel ?? 'incoming').replace(/[^a-zA-Z0-9_-]/gu, '_');
  let target = `${path}~${label}`;
  while (result.tree.has(target) || options.conflictPaths.has(target)) target += '_';
  options.conflictPaths.add(target);
  return target;
}

function splitTypeConflict(result, path, { base, ours, theirs }, options) {
  const oursRegular = (ours.mode & 0o170000) === 0o100000;
  const baseRegular = (base?.mode & 0o170000) === 0o100000;
  const target = conflictPath(result, path, oursRegular, options);
  resolved(result, path, oursRegular ? theirs : ours);
  resolved(result, target, oursRegular ? ours : theirs);
  conflict(result, path, baseRegular ? null : base, oursRegular ? null : ours, oursRegular ? theirs : null, 'type');
  conflict(result, target, baseRegular ? base : null, oursRegular ? ours : null, oursRegular ? null : theirs, 'type');
}

async function mergeEntry(repo, result, path, base, ours, theirs, options) {
  checkCancelled(options.signal);
  if (same(ours, theirs)) return resolved(result, path, ours);
  if (same(base, ours)) return resolved(result, path, theirs);
  if (same(base, theirs)) return resolved(result, path, ours);
  if (!ours || !theirs) {
    resolved(result, path, ours ?? theirs);
    return conflict(result, path, base, ours, theirs, 'modify/delete');
  }
  const type = ours.mode & 0o170000;
  const theirType = theirs.mode & 0o170000;
  if (type !== theirType && (type === 0o100000 || theirType === 0o100000)) {
    return splitTypeConflict(result, path, { base, ours, theirs }, options);
  }
  if (type !== theirType || type === 0o120000 || type === 0o160000) {
    resolved(result, path, ours);
    return conflict(result, path, base, ours, theirs, type === 0o160000 ? 'gitlink' : 'type');
  }
  const load = async entry => entry ? (await repo.odb.read(entry.oid, options)).data : new Uint8Array();
  const attributes = repo.attributes.get(path);
  let driver = attributes.merge;
  if (typeof driver === 'string' && !['text', 'union', 'binary'].includes(driver)) {
    repo.policy.ignored(`merge.${driver}`);
    driver = undefined;
  }
  const merged = mergeFile(await load(base), await load(ours), await load(theirs), { ...options, driver });
  const oid = await repo.odb.write('blob', merged.data, options);
  const mode = ours.mode === base?.mode ? theirs.mode : ours.mode;
  resolved(result, path, { oid, mode });
  const modeConflict = ours.mode !== theirs.mode && base?.mode !== ours.mode && base?.mode !== theirs.mode;
  if (!merged.clean || modeConflict) conflict(result, path, base, ours, theirs, merged.binary ? 'binary' : 'content');
}

function fixDirectoryConflicts(result, ours, theirs, options) {
  const paths = [...result.tree.keys()].sort();
  const relocated = new Set();
  for (const path of paths) {
    const components = path.split('/');
    components.pop();
    let prefix = '';
    for (const component of components) {
      prefix = prefix ? `${prefix}/${component}` : component;
      const file = result.tree.get(prefix);
      if (!file) continue;
      const target = conflictPath(result, prefix, ours.has(prefix), options);
      const ancestor = result.index.get(prefix, 1);
      const left = result.index.get(prefix, 2) ?? ours.get(prefix);
      const right = result.index.get(prefix, 3) ?? theirs.get(prefix);
      result.tree.delete(prefix);
      result.index.remove(prefix);
      relocated.add(prefix);
      resolved(result, target, file);
      conflict(result, target, ancestor, left, right, 'directory/file');
    }
  }
  result.conflicts = result.conflicts.filter(record => !relocated.has(record.path));
}

/** Three-way tree merge with rename identity tracking and explicit conflict index stages. */
export async function mergeTrees(repo, base, ours, theirs, options = {}) {
  const result = { tree: new Map(), index: new GitIndex({ version: repo.index.version }), conflicts: [] };
  options = { ...options, conflictPaths: new Set([...base.keys(), ...ours.keys(), ...theirs.keys()]) };
  const oursDiff = await treeDiff(repo, base, ours, { ...options, pathspec: [], patch: false });
  const theirsDiff = await treeDiff(repo, base, theirs, { ...options, pathspec: [], patch: false });
  const oursRenames = new Map(oursDiff.filter(change => change.status === 'R').map(change => [change.oldPath, change.path]));
  const theirsRenames = new Map(theirsDiff.filter(change => change.status === 'R').map(change => [change.oldPath, change.path]));
  const handledOurs = new Set();
  const handledTheirs = new Set();
  const destinations = new Map();
  for (const [path, original] of base) {
    const oursPath = oursRenames.get(path) ?? path;
    const theirsPath = theirsRenames.get(path) ?? path;
    const left = ours.get(oursPath);
    const right = theirs.get(theirsPath);
    handledOurs.add(oursPath);
    handledTheirs.add(theirsPath);
    if (oursPath !== path && theirsPath !== path && oursPath !== theirsPath) {
      resolved(result, oursPath, left);
      resolved(result, theirsPath, right);
      conflict(result, path, original, null, null, 'rename/rename');
      conflict(result, oursPath, null, left, null, 'rename/rename');
      conflict(result, theirsPath, null, null, right, 'rename/rename');
      continue;
    }
    const destination = oursPath !== path ? oursPath : theirsPath;
    if (destination !== path && (!left || !right)) {
      resolved(result, destination, left ?? right);
      conflict(result, destination, original, left, right, 'rename/delete');
      continue;
    }
    if (destinations.has(destination) && destinations.get(destination) !== path) {
      await mergeEntry(repo, result, destination, null, ours.get(destination), theirs.get(destination), options);
      continue;
    }
    destinations.set(destination, path);
    await mergeEntry(repo, result, destination, original, left, right, options);
  }
  const additions = new Set([...ours.keys()].filter(path => !handledOurs.has(path)).concat(
    [...theirs.keys()].filter(path => !handledTheirs.has(path))));
  for (const path of additions) {
    const left = handledOurs.has(path) ? null : ours.get(path);
    const right = handledTheirs.has(path) ? null : theirs.get(path);
    if (result.tree.has(path)) {
      const previous = result.tree.get(path);
      await mergeEntry(repo, result, path, null, left ?? previous, right ?? previous, options);
      continue;
    }
    await mergeEntry(repo, result, path, null, left, right, options);
  }
  fixDirectoryConflicts(result, ours, theirs, options);
  result.clean = result.conflicts.length === 0;
  return result;
}
