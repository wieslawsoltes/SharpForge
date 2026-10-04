import { GitRepository } from '../packages/git/src/repository.js';

export const identity = Object.freeze({ name: 'Git Fixture', email: 'fixture@example.test', timestamp: 1700000000, timezone: '+0230' });

export async function repository(options = {}) {
  const repo = new GitRepository(options);
  await repo.init();
  repo.config.set('user.name', identity.name).set('user.email', identity.email);
  await repo.config.save();
  return repo;
}

export async function commitFile(repo, path, text, options = {}) {
  await repo.worktree.write(path, text, { mode: options.mode ?? 0o100644 });
  await repo.add([path]);
  return repo.commit({ message: options.message ?? path, author: identity, committer: identity, ...options });
}

export async function fileText(repo, path) {
  const file = await repo.worktree.read(path);
  return file ? new TextDecoder().decode(file.data) : null;
}

export async function objectText(repo, oid) {
  return new TextDecoder().decode((await repo.odb.read(oid)).data);
}
