import { GitError, checkCancelled } from './errors.js';
import { checkout } from './checkout.js';
import { createCommit } from './commit.js';
import { applyCommitChange, extendSnapshot, requireClean } from './sequencer-apply.js';

const encoder = new TextEncoder();
const actions = new Set(['pick', 'reword', 'squash', 'fixup', 'drop']);

async function persist(repo, state) {
  await repo.writeState('rebase', state);
  const values = { 'orig-head': state.original, onto: state.onto, 'head-name': state.headName,
    'git-rebase-todo': state.todo.slice(state.position).map(item => `${item.action} ${item.oid}`).join('\n'),
    done: state.done.map(item => `${item.action} ${item.oid}`).join('\n') };
  for (const [name, value] of Object.entries(values)) await repo.store.set(`rebase-merge/${name}`, encoder.encode(`${value}\n`));
}

async function cleanup(repo) {
  await repo.deleteState('rebase');
  await repo.deleteState('CHERRY_PICK_HEAD');
  for (const key of await repo.store.list('rebase-merge/')) await repo.store.delete(key);
}

async function completeStep(repo, state, options) {
  const active = state.active;
  if (!active) return;
  if (repo.index.unmerged.length) throw new GitError('Conflict', 'Resolve and stage conflicts before continuing the rebase');
  let message = options.message ?? active.message;
  if (active.action === 'reword' && !message) return { status: 'needs-message', oid: active.oid };
  const current = await repo.refs.read('HEAD');
  if (current !== active.head) {
    const existing = await repo.readCommit(current);
    if (existing.tree !== await repo.writeTree(options)) throw new GitError('Conflict', 'HEAD moved outside the rebase');
    state.created.push(current);
  } else {
    const amend = active.action === 'squash' || active.action === 'fixup';
    const previous = amend ? await repo.readCommit(current) : null;
    if (amend) message = active.action === 'fixup' ? previous.message : `${previous.message.trimEnd()}\n\n${active.message}`;
    const commit = await createCommit(repo, { ...options, message, amend, author: amend ? previous.author : active.author,
      allowEmpty: options.allowEmpty ?? state.allowEmpty });
    state.created.push(commit.oid);
  }
  state.done.push(state.todo[state.position]);
  state.position++;
  state.active = null;
  await repo.deleteState('CHERRY_PICK_HEAD');
  await persist(repo, state);
  return null;
}

async function finish(repo, state) {
  const oid = await repo.refs.read('HEAD');
  if (state.headName?.startsWith('refs/heads/')) {
    await repo.refs.update(state.headName, oid, { expected: state.original, message: `rebase (finish): onto ${state.onto}` });
    await repo.refs.setSymbolic('HEAD', state.headName, { expected: oid, message: 'rebase (finish): returning to branch' });
  }
  await cleanup(repo);
  return { status: 'completed', oid, original: state.original, commits: state.created };
}

async function run(repo, state, options) {
  while (state.position < state.todo.length) {
    checkCancelled(options.signal);
    const step = state.todo[state.position];
    if (step.action === 'drop') {
      state.done.push(step);
      state.position++;
      await persist(repo, state);
      continue;
    }
    if ((step.action === 'squash' || step.action === 'fixup') && !state.created.length) {
      throw new GitError('Conflict', 'Squash/fixup requires a preceding replayed commit');
    }
    const commit = await repo.readCommit(step.oid, options);
    state.active = { action: step.action, oid: commit.oid, author: commit.author, head: await repo.refs.read('HEAD'),
      message: step.action === 'reword' ? step.message ?? null : step.message ?? commit.message, phase: 'prepared' };
    await persist(repo, state);
    await repo.writeState('CHERRY_PICK_HEAD', { oid: commit.oid });
    const merged = await applyCommitChange(repo, commit, { ...options, mainline: state.mainline,
      beforeWrite: async snapshot => {
        state.active.snapshot = snapshot;
        extendSnapshot(state.snapshot, snapshot);
        await persist(repo, state);
      } });
    state.active.phase = 'applied';
    await persist(repo, state);
    if (!merged.clean) return { status: 'conflicted', oid: commit.oid, conflicts: merged.conflicts, position: state.position };
    if (step.action === 'reword' && !state.active.message) return { status: 'needs-message', oid: commit.oid };
    const paused = await completeStep(repo, state, options);
    if (paused) return paused;
  }
  return finish(repo, state);
}

async function transition(repo, state, action, options) {
  if (!state) throw new GitError('NotFound', 'No rebase is in progress');
  if (action === 'abort') {
    const raw = await repo.refs.read('HEAD', { deref: false });
    if (raw?.startsWith('refs/')) throw new GitError('Conflict', 'HEAD was attached outside the in-progress rebase');
    await repo.restoreSnapshot(state.snapshot);
    if (state.headName?.startsWith('refs/')) await repo.refs.setSymbolic('HEAD', state.headName, { expected: raw });
    else await repo.refs.update('HEAD', state.original, { expected: raw, deref: false, message: 'rebase: abort' });
    await cleanup(repo);
    return { status: 'aborted', oid: state.original };
  }
  if (action === 'skip') {
    if (!state.active?.snapshot) throw new GitError('Conflict', 'No rebase step is available to skip');
    await repo.restoreSnapshot(state.active.snapshot);
    state.done.push({ ...state.todo[state.position], action: 'drop' });
    state.position++;
    state.active = null;
    await persist(repo, state);
  } else if (action === 'continue') {
    if (state.active?.phase === 'prepared') {
      if (state.active.snapshot) await repo.restoreSnapshot(state.active.snapshot);
      state.active = null;
    } else {
      const paused = await completeStep(repo, state, options);
      if (paused) return paused;
    }
  } else throw new GitError('Unsupported', 'Unknown rebase action', { action });
  return run(repo, state, options);
}

/** Reload-safe interactive rebase with pick/reword/squash/fixup/drop and CAS branch finalization. */
export async function rebase(repo, onto, options = {}) {
  const action = options.action ?? (options.abort ? 'abort' : options.continue ? 'continue' : options.skip ? 'skip' : 'start');
  let state = await repo.readState('rebase');
  if (action !== 'start') return transition(repo, state, action, options);
  if (state || await repo.readState('merge') || await repo.readState('sequencer')) {
    throw new GitError('Conflict', 'Another repository operation is in progress');
  }
  await requireClean(repo, options);
  const original = await repo.refs.read('HEAD');
  if (!original) throw new GitError('Conflict', 'Rebase requires an existing HEAD commit');
  const target = await repo.revParse(onto, options);
  const upstream = await repo.revParse(options.upstream ?? onto, options);
  if (typeof target !== 'string' || typeof upstream !== 'string') throw new GitError('Corrupt', 'Rebase requires scalar commit revisions');
  const commits = await repo.graph.walk([original], { exclude: [upstream], ...options });
  const todo = options.todo ?? commits.reverse().filter(commit => commit.parents.length < 2).map(commit => ({ action: 'pick', oid: commit.oid }));
  for (const step of todo) {
    if (!actions.has(step.action)) throw new GitError('Unsupported', 'Unsupported rebase todo command', { action: step.action });
    step.oid = await repo.revParse(step.oid, options);
  }
  const targetTree = await repo.readTree(target, options);
  const paths = new Set([...repo.index.entries.map(entry => entry.path), ...targetTree.keys()]);
  state = { original, headName: await repo.refs.read('HEAD', { deref: false }), onto: target, todo, position: 0,
    done: [], created: [], active: null, mainline: options.mainline, allowEmpty: !!options.allowEmpty, snapshot: await repo.snapshot(paths) };
  await persist(repo, state);
  await repo.refs.update('ORIG_HEAD', original, { expected: await repo.refs.read('ORIG_HEAD'), message: 'rebase: save original HEAD' });
  try { await checkout(repo, target, { ...options, detach: true }); }
  catch (error) { await cleanup(repo); throw error; }
  return run(repo, state, options);
}
