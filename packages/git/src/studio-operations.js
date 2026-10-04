import { GitError, checkCancelled, checkLimit } from './errors.js';
import { diffLines } from './diff/lines.js';

const text = object => object ? new TextDecoder().decode(object.data) : '';
const decode = object => ({ text: text(object), binary: object?.data?.includes(0) ?? false, oid: object?.oid ?? null });

async function fileVersions(repository, path, context) {
  let head;
  if (await repository.refs.read('HEAD')) head = (await repository.readTree('HEAD', context)).get(path);
  await repository.loadIndex(context);
  const staged = repository.index.get(path);
  const [base, index, working] = await Promise.all([
    head ? repository.odb.read(head.oid, context) : null,
    staged ? repository.odb.read(staged.oid, context) : null,
    repository.worktree.read(path, context)
  ]);
  return { path, base: decode(base), index: decode(index), working: decode(working) };
}

/** Editor integration stays on worker messages and never serializes credential state. */
export const studioOperations = Object.freeze([
  {
    name: 'syncFiles', mutates: true,
    async run(repository, { files, removePaths = [] }, context) {
      if (!Array.isArray(files)) throw new GitError('Corrupt', 'A file array is required');
      checkLimit(files.length + removePaths.length, 100000, 'Workspace file count');
      for (const file of files) {
        checkCancelled(context.signal);
        await repository.worktree.write(file.path, file.data ?? file.text, { ...context, mode: file.mode });
      }
      for (const path of removePaths) {
        checkCancelled(context.signal);
        await repository.worktree.remove(path, context);
      }
      return { written: files.length, removed: removePaths.length };
    }
  },
  {
    name: 'files',
    async run(repository, params, context) {
      const paths = await repository.worktree.list(context);
      checkLimit(paths.length, params.maxFiles ?? 100000, 'Workspace file count');
      const result = [];
      let bytes = 0;
      for (const path of paths) {
        checkCancelled(context.signal);
        const file = await repository.worktree.read(path, context);
        if (!file) continue;
        bytes += file.data.byteLength;
        checkLimit(bytes, params.maxBytes ?? 64 * 1024 * 1024, 'Workspace message bytes');
        result.push({ path, data: file.data, mode: file.mode });
      }
      return result;
    }
  },
  {
    name: 'fileVersions',
    async run(repository, params, context) {
      const versions = await fileVersions(repository, params.path, context);
      const before = params.staged ? versions.base : versions.index;
      const after = params.staged ? versions.index : versions.working;
      return { ...versions, lines: before.binary || after.binary ? [] : diffLines(before.text, after.text, context) };
    }
  },
  {
    name: 'conflict',
    async run(repository, params, context) {
      await repository.loadIndex(context);
      const versions = [];
      for (const stage of [1, 2, 3]) {
        const entry = repository.index.get(params.path, stage);
        const object = entry ? await repository.odb.read(entry.oid, context) : null;
        versions.push(decode(object));
      }
      return { path: params.path, base: versions[0], ours: versions[1], theirs: versions[2] };
    }
  },
  {
    name: 'resolveConflict', mutates: true,
    async run(repository, params, context) {
      await repository.worktree.write(params.path, params.text, context);
      await repository.add(params.path, context);
      return { path: params.path, resolved: true };
    }
  },
  {
    name: 'configuration', mutates: true,
    async run(repository, { changes = {} }, context) {
      const allowed = new Set(['user.name', 'user.email', 'init.defaultBranch', 'core.autocrlf', 'core.filemode']);
      for (const [key, value] of Object.entries(changes)) {
        if (!allowed.has(key)) throw new GitError('Unsafe', 'Configuration key is not editable through the Studio settings surface', { key });
        repository.config.set(key, value);
      }
      if (Object.keys(changes).length) await repository.config.save(context);
      return Object.fromEntries([...allowed].map(key => [key, repository.config.get(key)]));
    }
  }
]);
