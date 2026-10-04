import { GitError, checkCancelled } from './errors.js';
import { createCommit } from './commit.js';
import { applyCommitChange, extendSnapshot, requireClean, replayRevisions } from './sequencer-apply.js';

const encoder = new TextEncoder();

async function persist(repo, state) {
  await repo.writeState('sequencer', state);
  await repo.store.set('sequencer/head', encoder.encode(`${state.original}\n`));
  await repo.store.set('sequencer/todo', encoder.encode(state.todo.slice(state.position).map(oid => `${state.kind} ${oid}\n`).join('')));
}

async function cleanup(repo) {
  await repo.deleteState('sequencer');
  await repo.deleteState('CHERRY_PICK_HEAD');
  await repo.deleteState('REVERT_HEAD');
  await repo.store.delete('sequencer/head');
  await repo.store.delete('sequencer/todo');
}

function replayMessage(kind, commit) {
  return kind === 'revert' ? `Revert "${commit.message.split('\n')[0]}"\n\nThis reverts commit ${commit.oid}.\n` : commit.message;
}

async function commitActive(repo, state, options) {
  if (repo.index.unmerged.length) throw new GitError('Conflict', 'Resolve and stage every conflict before continuing');
  const active = state.active;
  if (!active) return;
  const current = await repo.refs.read('HEAD');
  if (current !== active.head) {
    const existing = await repo.readCommit(current, options);
    if (existing.parents[0] !== active.head || existing.tree !== await repo.writeTree(options)) {
      throw new GitError('Conflict', 'HEAD moved outside the sequencer');
    }
    state.created.push(current);
  } else if (!state.noCommit) {
    const result = await createCommit(repo, { ...options, message: options.message ?? active.message,
      author: state.kind === 'revert' ? options.author : active.author, allowEmpty: options.allowEmpty ?? state.allowEmpty });
    state.created.push(result.oid);
  }
  state.position++;
  state.active = null;
  await repo.deleteState(state.kind === 'revert' ? 'REVERT_HEAD' : 'CHERRY_PICK_HEAD');
  await persist(repo, state);
}

async function run(repo, state, options) {
  while (state.position < state.todo.length) {
    checkCancelled(options.signal);
    const commit = await repo.readCommit(state.todo[state.position], options);
    state.active = { oid: commit.oid, head: await repo.refs.read('HEAD'), message: replayMessage(state.kind, commit),
      author: commit.author, phase: 'prepared' };
    await persist(repo, state);
    await repo.writeState(state.kind === 'revert' ? 'REVERT_HEAD' : 'CHERRY_PICK_HEAD', { oid: commit.oid });
    const merged = await applyCommitChange(repo, commit, { ...options, mainline: state.mainline, revert: state.kind === 'revert',
      beforeWrite: async snapshot => {
        state.active.snapshot = snapshot;
        extendSnapshot(state.snapshot, snapshot);
        await persist(repo, state);
      } });
    state.active.phase = 'applied';
    await persist(repo, state);
    if (!merged.clean) return { status: 'conflicted', kind: state.kind, oid: commit.oid, conflicts: merged.conflicts, position: state.position };
    if (!state.noCommit && !state.allowEmpty && !options.allowEmpty
      && (await repo.readCommit(state.active.head)).tree === await repo.writeTree(options)) {
      return { status: 'empty', kind: state.kind, oid: commit.oid, position: state.position };
    }
    await commitActive(repo, state, options);
  }
  await cleanup(repo);
  return { status: state.noCommit ? 'staged' : 'completed', kind: state.kind, oid: await repo.refs.read('HEAD'), commits: state.created };
}

/** Persisted cherry-pick/revert sequencer with explicit continue, skip and abort transitions. */
export async function sequence(repo, kind, revisions, options = {}) {
  if (!['cherry-pick', 'revert'].includes(kind)) throw new GitError('Unsupported', 'Unknown sequencer operation', { kind });
  const action = options.action ?? (options.abort ? 'abort' : options.continue ? 'continue' : options.skip ? 'skip' : 'start');
  let state = await repo.readState('sequencer');
  if (action !== 'start') {
    if (!state || state.kind !== kind) throw new GitError('NotFound', 'No matching sequencer operation is in progress');
    if (action === 'abort') {
      const current = await repo.refs.read('HEAD');
      if (current !== state.original && !state.created.includes(current) && current !== state.active?.head) {
        throw new GitError('Conflict', 'HEAD moved outside the sequencer');
      }
      await repo.restoreSnapshot(state.snapshot);
      await repo.refs.update('HEAD', state.original, { expected: current, message: `${kind}: abort` });
      await cleanup(repo);
      return { status: 'aborted', oid: state.original };
    }
    if (action === 'skip') {
      if (!state.active?.snapshot) throw new GitError('Conflict', 'No active sequencer step can be skipped');
      await repo.restoreSnapshot(state.active.snapshot);
      state.position++;
      state.active = null;
      await persist(repo, state);
    } else if (action === 'continue') {
      if (state.active?.phase === 'prepared') {
        if (state.active.snapshot) await repo.restoreSnapshot(state.active.snapshot);
        state.active = null;
      } else await commitActive(repo, state, options);
    }
    else throw new GitError('Unsupported', 'Unknown sequencer action', { action });
    return run(repo, state, options);
  }
  if (state || await repo.readState('merge') || await repo.readState('rebase')) throw new GitError('Conflict', 'Another repository operation is in progress');
  await requireClean(repo, options);
  const original = await repo.refs.read('HEAD');
  if (!original) throw new GitError('Conflict', 'Replay requires an existing HEAD commit');
  const todo = await replayRevisions(repo, revisions, { ...options, revert: kind === 'revert' });
  if (!todo.length) throw new GitError('NotFound', 'No commits selected for replay');
  state = { kind, original, todo, position: 0, created: [], active: null, mainline: options.mainline,
    noCommit: !!options.noCommit, allowEmpty: !!options.allowEmpty,
    snapshot: await repo.snapshot(repo.index.entries.map(entry => entry.path)) };
  await persist(repo, state);
  return run(repo, state, options);
}
