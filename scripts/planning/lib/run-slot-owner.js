import {readFileSync, readlinkSync} from 'node:fs';

const positivePid = value => Number.isSafeInteger(value) && value > 0;

export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function procIdentity(pid) {
  const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
  return {state: fields[0], start: fields[19]};
}

/** Linux procfs can expose the host identity while process.pid belongs to a nested PID namespace. */
export function currentRunSlotOwner() {
  if (process.platform !== 'linux') return {kind: 'pid', pid: process.pid};
  const pid = Number(readlinkSync('/proc/self'));
  const {start} = procIdentity('self');
  const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  if (!positivePid(pid) || !/^\d+$/.test(start) || !/^[a-f0-9-]{36}$/.test(boot)) {
    throw new Error('Cannot establish the Linux run-slot process identity');
  }
  return {kind: 'linux-proc', pid, start, boot};
}

export function validRunSlotOwner(owner) {
  return owner && typeof owner === 'object' && !Array.isArray(owner) && positivePid(owner.pid) &&
    (owner.kind === 'pid' && Object.keys(owner).length === 2 || owner.kind === 'linux-proc' &&
      Object.keys(owner).length === 4 && typeof owner.start === 'string' && /^\d+$/.test(owner.start) &&
      typeof owner.boot === 'string' && /^[a-f0-9-]{36}$/.test(owner.boot));
}

export function runSlotOwnerAlive(owner) {
  if (!validRunSlotOwner(owner)) return false;
  if (owner.kind === 'pid') return pidAlive(owner.pid);
  if (process.platform !== 'linux') return false;
  try {
    const identity = procIdentity(owner.pid);
    return !['Z', 'X'].includes(identity.state) && identity.start === owner.start &&
      readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() === owner.boot;
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes(error.code)) return false;
    throw error;
  }
}

/** Older wrappers read only numeric PIDs; a live Linux PID 1 guards the richer external lease record. */
export function legacyRunSlotGuard() {
  return process.platform === 'linux' && pidAlive(1) ? 1 : process.pid;
}
