import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

/** Bounded asynchronous reference command. Async I/O also permits a live local Git HTTP fixture. */
export function nativeGit(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(options.git ?? 'git', ['-c', 'core.autocrlf=false', '-c', 'core.quotepath=false', ...args], {
      cwd: options.cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C', ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    });
    const chunks = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };
    const maximum = options.maxBytes ?? 32 * 1024 * 1024;
    let failure;
    const timer = setTimeout(() => {
      failure = new Error(`Native Git command exceeded its ${options.timeoutMs ?? 60_000} ms deadline`);
      child.kill('SIGKILL');
    }, options.timeoutMs ?? 60_000);
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', bytes => {
      sizes[stream] += bytes.length;
      if (sizes[stream] > maximum) {
        failure = new Error('Native Git output exceeded its byte bound');
        child.kill('SIGKILL');
      } else chunks[stream].push(bytes);
    });
    child.on('error', error => { failure = error; });
    child.on('close', code => {
      clearTimeout(timer);
      const stdout = Buffer.concat(chunks.stdout);
      const stderr = Buffer.concat(chunks.stderr);
      if (failure) reject(failure);
      else if (code && !options.allowFailure) reject(new Error(`git ${args[0]} exited ${code}: ${stderr.toString()}`));
      else resolve({ code, stdout, stderr, text: stdout.toString('utf8').trimEnd() });
    });
    child.stdin.on('error', error => {
      if (error.code !== 'EPIPE') { failure = error; child.kill('SIGKILL'); }
    });
    child.stdin.end(options.input);
  });
}

export async function gitAvailability(options = {}) {
  try { return { available: true, version: (await nativeGit(['--version'], options)).text }; }
  catch (error) {
    if (error.code === 'ENOENT') return { available: false, reason: 'native Git executable is absent' };
    throw error;
  }
}

/** Isolated deterministic Git fixture; no user configuration, hooks or network are required. */
export async function fixtureWorkspace(prefix = 'sharpforge-git-conformance-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const env = {
    GIT_CONFIG_GLOBAL: join(root, 'global-config'), GIT_CONFIG_SYSTEM: join(root, 'system-config'),
    GIT_AUTHOR_NAME: 'Fixture Author', GIT_AUTHOR_EMAIL: 'author@example.test',
    GIT_COMMITTER_NAME: 'Fixture Committer', GIT_COMMITTER_EMAIL: 'committer@example.test',
    GIT_AUTHOR_DATE: '1700000000 +0000', GIT_COMMITTER_DATE: '1700000000 +0000',
    GIT_TERMINAL_PROMPT: '0'
  };
  return {
    root, env,
    git: (args, options = {}) => nativeGit(args, { cwd: root, ...options, env: { ...env, ...options.env } }),
    write: async (directory, path, value) => {
      const destination = join(directory, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, value);
    },
    dispose: () => rm(root, { recursive: true, force: true })
  };
}
