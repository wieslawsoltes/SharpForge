import {randomBytes} from 'node:crypto';
import {closeSync, fstatSync, linkSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {currentRunSlotOwner, legacyRunSlotGuard, pidAlive, runSlotOwnerAlive, validRunSlotOwner} from './run-slot-owner.js';

export const runSlotEnvironmentKey = 'SHARPFORGE_RUN_SLOT_LEASE';
const nonce = () => randomBytes(32).toString('hex');
const noncePattern = /^[a-f0-9]{64}$/;
const filePart = value => typeof value === 'string' && /^\d+$/.test(value);
const metadataDirectory = directory => resolve(directory) + '.leases';
const metadataPath = (directory, slot, file) => join(metadataDirectory(directory), `slot-${slot}-${file.dev}-${file.ino}.json`);
const sameFile = (left, right) => left?.dev === right?.dev && left?.ino === right?.ino;

function readText(path) {
  try { return readFileSync(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function readSlot(path) {
  let descriptor;
  try {
    descriptor = openSync(path, 'r');
    const stat = fstatSync(descriptor, {bigint: true});
    if (!stat.isFile()) throw new Error('Run-slot path is not a regular file');
    return {text: readFileSync(descriptor, 'utf8'), file: {dev: String(stat.dev), ino: String(stat.ino)}};
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function validLease(lease) {
  return lease && typeof lease === 'object' && !Array.isArray(lease) && Object.keys(lease).length === 8 &&
    lease.version === 2 && validRunSlotOwner(lease.owner) && typeof lease.nonce === 'string' && noncePattern.test(lease.nonce) &&
    typeof lease.directory === 'string' && lease.directory === resolve(lease.directory) &&
    Number.isSafeInteger(lease.slot) && lease.slot >= 0 && Number.isSafeInteger(lease.guardPid) && lease.guardPid > 0 &&
    lease.file && Object.keys(lease.file).length === 2 && filePart(lease.file.dev) && filePart(lease.file.ino) &&
    lease.kind === 'SharpForge.RunSlot';
}

function invalidLease() {
  return Object.assign(new Error('Invalid, expired or foreign inherited SharpForge run-slot lease'), {code: 'RUN_SLOT_LEASE_INVALID'});
}

/** The inherited environment is a local coordination capability, not a security boundary against the same OS user. */
export function inheritedRunSlot(env, directory) {
  const text = env[runSlotEnvironmentKey];
  if (text === undefined) return null;
  if (typeof text !== 'string' || text.length > 8192) throw invalidLease();
  let lease;
  try { lease = JSON.parse(text); } catch { throw invalidLease(); }
  if (!validLease(lease) || lease.directory !== resolve(directory)) throw invalidLease();
  const slot = readSlot(join(directory, `slot-${lease.slot}.lock`));
  if (!slot || !sameFile(slot.file, lease.file) || slot.text !== String(lease.guardPid) ||
      readText(metadataPath(directory, lease.slot, lease.file)) !== text || !runSlotOwnerAlive(lease.owner)) throw invalidLease();
  const release = () => {};
  release.environment = Object.freeze({[runSlotEnvironmentKey]: text});
  return release;
}

function removeOwnedSlot(directory, lease, text) {
  const path = join(directory, `slot-${lease.slot}.lock`);
  const metadata = metadataPath(directory, lease.slot, lease.file);
  const current = readSlot(path);
  if (current && sameFile(current.file, lease.file) && current.text === String(lease.guardPid) && readText(metadata) === text) {
    rmSync(path, {force: true});
  }
  if (readText(metadata) === text) rmSync(metadata, {force: true});
}

/** Publish complete numeric lock contents and inode-bound metadata before a contender can observe the lease. */
export function claimRunSlot(directory, slot) {
  const token = nonce(), guardPid = legacyRunSlotGuard(), owner = currentRunSlotOwner();
  const metadataRoot = metadataDirectory(directory);
  mkdirSync(metadataRoot, {recursive: true, mode: 0o700});
  const temporary = join(metadataRoot, `.claim-${token}`);
  writeFileSync(temporary, String(guardPid), {flag: 'wx', mode: 0o600});
  const file = readSlot(temporary).file;
  const lease = {version: 2, kind: 'SharpForge.RunSlot', owner, nonce: token,
    directory: resolve(directory), slot, guardPid, file};
  const text = JSON.stringify(lease), metadata = metadataPath(directory, slot, file);
  let published = false;
  try {
    writeFileSync(metadata, text, {flag: 'wx', mode: 0o600});
    linkSync(temporary, join(directory, `slot-${slot}.lock`));
    published = true;
  } finally {
    rmSync(temporary, {force: true});
    if (!published && readText(metadata) === text) rmSync(metadata, {force: true});
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    process.off('exit', release);
    removeOwnedSlot(directory, lease, text);
  };
  release.environment = Object.freeze({[runSlotEnvironmentKey]: text});
  process.once('exit', release);
  return release;
}

function metadataOwner(directory, slot, observed) {
  const text = readText(metadataPath(directory, slot, observed.file));
  if (text === null) {
    // A live legacy numeric PID is deliberately conservative across old PID namespaces.
    const pid = Number(observed.text.trim());
    return {alive: Number.isSafeInteger(pid) && pid > 0 && pidAlive(pid), metadata: null};
  }
  let lease;
  try { lease = JSON.parse(text); } catch { throw invalidLease(); }
  if (!validLease(lease) || lease.directory !== resolve(directory) || lease.slot !== slot ||
      !sameFile(lease.file, observed.file) || observed.text !== String(lease.guardPid)) throw invalidLease();
  return {alive: runSlotOwnerAlive(lease.owner), metadata: text};
}

/** Only one metadata-aware contender reaps a dead guarded inode; legacy cleanup cannot participate in that election. */
export function reclaimRunSlot(directory, slot) {
  const path = join(directory, `slot-${slot}.lock`), observed = readSlot(path);
  if (!observed) return;
  const owner = metadataOwner(directory, slot, observed);
  if (owner.alive) return;
  if (owner.metadata === null || process.platform !== 'linux' || Number(observed.text) !== 1 || !pidAlive(1)) {
    throw Object.assign(new Error('Dead unguarded run-slot record requires explicit recovery after its owner is verified absent'),
      {code: 'RUN_SLOT_LEGACY_STALE'});
  }
  const metadata = metadataPath(directory, slot, observed.file), reaper = metadata + '.reaper';
  mkdirSync(metadataDirectory(directory), {recursive: true, mode: 0o700});
  const temporary = reaper + '.' + nonce(), reaperText = JSON.stringify(currentRunSlotOwner());
  writeFileSync(temporary, reaperText, {flag: 'wx', mode: 0o600});
  let elected = false;
  try {
    try { linkSync(temporary, reaper); elected = true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // A killed cleanup owner is an explicit recovery error, never permission to admit an extra heavy run.
      const existing = readText(reaper);
      if (existing && !runSlotOwnerAlive(JSON.parse(existing))) {
        throw Object.assign(new Error('An interrupted run-slot cleanup requires removal of its stale reaper record'),
          {code: 'RUN_SLOT_CLEANUP_INTERRUPTED'});
      }
      return;
    }
    const current = readSlot(path);
    if (current && sameFile(current.file, observed.file) && current.text === observed.text) {
      rmSync(path, {force: true});
      if (owner.metadata !== null && readText(metadata) === owner.metadata) rmSync(metadata, {force: true});
    }
  } finally {
    rmSync(temporary, {force: true});
    if (elected) rmSync(reaper, {force: true});
  }
}
