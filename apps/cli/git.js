#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GitError, GitRepository, createHttpTransport, validateRemoteUrl, cloneRepository, pushRemote,
  formatPorcelainV2, verifyRepositoryIntegrity
} from '@sharpforge/git';
import { openNodeRepository, initNodeRepository } from '@sharpforge/git/node';

const commands = new Set(['init', 'clone', 'status', 'add', 'commit', 'log', 'diff', 'push', 'rev-parse', 'blame', 'fsck']);
const valueOptions = new Set([
  '-C', '--object-format', '--branch', '-b', '--message', '-m', '--author', '--date', '--max-count', '-n', '--skip',
  '--grep', '--since', '--until', '--allow-origin', '--allow-credential-origin', '--authorization-env', '--proxy',
  '--depth', '--filter', '--force-with-lease', '--porcelain'
]);
const flagOptions = new Set([
  '--json', '-z', '--bare', '--all', '-A', '--update', '-u', '--force', '-f', '--intent-to-add', '-N',
  '--amend', '--allow-empty', '--allow-empty-message', '--oneline', '--follow', '--first-parent', '--reverse',
  '--cached', '--staged', '--name-only', '--name-status', '--no-renames', '--no-checkout', '--ignored',
  '--allow-insecure-localhost', '--no-reflogs', '--unreachable', '--help', '-h'
]);
const repeatable = new Set(['--allow-origin', '--allow-credential-origin', '--message', '-m', '--force-with-lease']);
const networkOptions = ['--allow-origin', '--allow-credential-origin', '--authorization-env', '--proxy', '--allow-insecure-localhost'];
const commandOptions = Object.freeze({
  init: ['--object-format', '--branch', '-b', '--bare'],
  clone: [...networkOptions, '--object-format', '--branch', '-b', '--bare', '--no-checkout', '--depth', '--filter'],
  status: ['--porcelain', '-z', '--ignored'],
  add: ['--all', '-A', '--update', '-u', '--force', '-f', '--intent-to-add', '-N'],
  commit: ['--message', '-m', '--author', '--date', '--amend', '--allow-empty', '--allow-empty-message'],
  log: ['--max-count', '-n', '--skip', '--all', '--oneline', '--follow', '--first-parent', '--reverse', '--author', '--grep', '--since', '--until'],
  diff: ['--cached', '--staged', '--name-only', '--name-status', '--no-renames'],
  push: [...networkOptions, '--force', '-f', '--force-with-lease'],
  'rev-parse': [], blame: [], fsck: ['--no-reflogs', '--unreachable']
});

function parseArguments(argv) {
  const options = new Map();
  const positionals = [];
  const paths = [];
  const ordered = [];
  let afterSeparator = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--') { afterSeparator = true; continue; }
    if (afterSeparator) { paths.push(argument); continue; }
    if (!argument.startsWith('-') || argument === '-') { positionals.push(argument); continue; }
    const equal = argument.indexOf('=');
    const name = equal >= 0 ? argument.slice(0, equal) : argument;
    if (!valueOptions.has(name) && !flagOptions.has(name)) throw new GitError('Unsupported', `Unknown Git option: ${name}`);
    let value = true;
    if (valueOptions.has(name)) {
      value = equal >= 0 ? argument.slice(equal + 1) : name === '--porcelain' ? 'v2' : argv[++index];
      if (typeof value !== 'string' || !value.length) throw new GitError('Corrupt', `Missing value for ${name}`);
    } else if (equal >= 0) throw new GitError('Corrupt', `Flag does not accept a value: ${name}`);
    if (options.has(name) && !repeatable.has(name)) throw new GitError('Corrupt', `Duplicate Git option: ${name}`);
    options.set(name, [...options.get(name) ?? [], value]);
    ordered.push({ name, value });
  }
  return {
    positionals, paths, ordered,
    get: (name, fallback) => options.get(name)?.at(-1) ?? fallback,
    has: name => options.has(name), all: name => options.get(name) ?? []
  };
}

function validateOptions(command, parsed) {
  const allowed = new Set(['-C', '--json', '--help', '-h', ...commandOptions[command]]);
  for (const { name } of parsed.ordered) {
    if (!allowed.has(name)) throw new GitError('Unsupported', `${name} is not supported by ${command}`);
  }
  if ((parsed.has('--update') || parsed.has('-u')) && (parsed.has('--all') || parsed.has('-A'))) {
    throw new GitError('Conflict', 'Choose either add --all or --update');
  }
}

function numberOption(value, name, { minimum = 0, maximum = 1_000_000 } = {}) {
  if (!/^[0-9]+$/.test(String(value))) throw new GitError('Corrupt', `${name} requires a nonnegative integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new GitError('Limit', `${name} exceeds its limit`);
  return number;
}

function timestamp(value) {
  if (value === undefined) return {};
  const raw = /^@?(-?[0-9]+) ([+-][0-9]{4})$/.exec(value);
  if (raw && Number.isSafeInteger(Number(raw[1]))) return { timestamp: Number(raw[1]), timezone: raw[2] };
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new GitError('Corrupt', 'Invalid explicit Git date');
  return { timestamp: Math.floor(parsed / 1000), timezone: '+0000' };
}

function identity(repo, env, role, parsed) {
  const prefix = `GIT_${role.toUpperCase()}_`;
  let name = env[`${prefix}NAME`] ?? repo.config.get('user.name');
  let email = env[`${prefix}EMAIL`] ?? repo.config.get('user.email');
  if (role === 'author' && parsed.has('--author')) {
    const match = /^(.*?) <([^<>\r\n]+)>$/.exec(parsed.get('--author'));
    if (!match) throw new GitError('Corrupt', '--author must be Name <email>');
    [, name, email] = match;
  }
  return { name, email, ...timestamp(role === 'author' ? parsed.get('--date', env[`${prefix}DATE`]) : env[`${prefix}DATE`]) };
}

function output(context, value) {
  (context.stdout ?? process.stdout).write(value);
}

function writeResult(context, parsed, value, text) {
  output(context, parsed.has('--json') ? `${JSON.stringify(value)}\n` : text);
}

function transportFor(parsed, context) {
  if (context.transport) return context.transport;
  const origins = parsed.all('--allow-origin');
  const credentialOrigins = parsed.all('--allow-credential-origin');
  const variable = parsed.get('--authorization-env');
  const env = context.env ?? process.env;
  if (variable && (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable) || !env[variable])) {
    throw new GitError('Auth', 'The selected authorization environment variable is missing');
  }
  return createHttpTransport({
    origins, credentialOrigins, fetch: context.fetch ?? globalThis.fetch, proxyUrl: parsed.get('--proxy'),
    allowInsecureLocalhost: parsed.has('--allow-insecure-localhost'),
    credentialProvider: variable ? async () => ({ headers: { authorization: env[variable] } }) : undefined
  });
}

async function ensureEmptyDirectory(directory) {
  try {
    if ((await readdir(directory)).length) throw new GitError('Conflict', 'Clone destination must be new or empty');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function openRepository(directory, parsed, context, initialize = false) {
  if (context.repository) return { repo: context.repository, close: async () => {} };
  const options = {
    directory, bare: parsed.has('--bare'), signal: context.signal,
    algorithm: parsed.get('--object-format', 'sha1'), defaultBranch: parsed.get('--branch', parsed.get('-b', 'main'))
  };
  const descriptor = await (initialize ? initNodeRepository(options) : openNodeRepository(options));
  const repo = new GitRepository(descriptor);
  try { await repo.init({ signal: context.signal }); }
  catch (error) { await descriptor.store.close(); throw error; }
  return { repo, bare: !descriptor.worktree, close: async () => { repo.dispose(); repo.history?.dispose(); await descriptor.store.close(); } };
}

async function cloneCommand(args, parsed, context, directory) {
  if (args.length < 1 || args.length > 2 || parsed.paths.length) throw new GitError('Corrupt', 'Use clone URL [DIRECTORY]');
  const url = validateRemoteUrl(args[0], { allowInsecureLocalhost: parsed.has('--allow-insecure-localhost') });
  const destination = resolve(directory, args[1] ?? basename(url.pathname).replace(/\.git$/, ''));
  await ensureEmptyDirectory(destination);
  const opened = await openRepository(destination, parsed, context, true);
  try {
    const repo = opened.repo;
    const result = await cloneRepository({
      odb: repo.odb, refs: repo.refs, config: repo.config, worktree: repo.worktree, algorithm: repo.algorithm,
      url: url.href, transport: transportFor(parsed, context), signal: context.signal,
      branch: parsed.get('--branch', parsed.get('-b')), noCheckout: parsed.has('--no-checkout') || parsed.has('--bare'),
      depth: parsed.has('--depth') ? numberOption(parsed.get('--depth'), '--depth', { minimum: 1 }) : undefined,
      filter: parsed.get('--filter'), checkout: ({ oid }) => repo.checkout(oid, { force: true, signal: context.signal })
    });
    // A clone checkout selects the advertised branch after materializing its tree.
    if (result.branch && !parsed.has('--bare')) await repo.refs.setSymbolic('HEAD', result.branch, { signal: context.signal });
    writeResult(context, parsed, result, `${result.oid ?? '(empty repository)'}\n`);
  } finally { await opened.close(); }
}

function compactCommit(commit) {
  const { oid, tree, parents, author, committer, message, path, previousPath } = commit;
  return { oid, tree, parents, author, committer, message, path, previousPath };
}

async function pushCommand(repo, args, parsed, context) {
  if (args.length > 2 || parsed.paths.length) throw new GitError('Corrupt', 'Use push [REMOTE] [SOURCE:DESTINATION]');
  const remoteName = args[0] ?? 'origin';
  const url = /^https?:\/\//.test(remoteName) ? remoteName : repo.config.get(`remote.${remoteName}.url`);
  if (!url) throw new GitError('NotFound', 'The selected Git remote has no URL');
  const head = await repo.refs.resolve('HEAD');
  const specification = args[1] ?? head.ref;
  const parts = specification.split(':');
  if (parts.length > 2) throw new GitError('Corrupt', 'Invalid push refspec');
  const source = parts[0];
  let destination = parts[1] ?? source;
  if (!destination.startsWith('refs/')) destination = `refs/heads/${destination}`;
  if (!source) throw new GitError('Unsupported', 'CLI ref deletion requires a separately authorized repository action');
  const oid = await repo.revParse(source, { signal: context.signal });
  if (typeof oid !== 'string') throw new GitError('Corrupt', 'Push source must identify one object');
  const leases = {};
  for (const value of parsed.all('--force-with-lease')) {
    const separator = value.indexOf(':');
    if (separator < 1) throw new GitError('Corrupt', 'Force-with-lease requires REF:EXPECTED-OID');
    const name = value.slice(0, separator);
    leases[name.startsWith('refs/') ? name : `refs/heads/${name}`] = value.slice(separator + 1) || null;
  }
  const result = await pushRemote({
    odb: repo.odb, refs: repo.refs, algorithm: repo.algorithm, url, remoteName,
    transport: transportFor(parsed, context), updates: [{ name: destination, newOid: oid }],
    force: parsed.has('--force') || parsed.has('-f'), leases,
    confirmation: context.confirmation, verifyConfirmation: context.verifyConfirmation, signal: context.signal
  });
  writeResult(context, parsed, result, `Pushed ${destination}\n`);
}

async function statusCommand(repo, args, parsed, context) {
  if (args.length || parsed.paths.length) throw new GitError('Corrupt', 'Status accepts no positional arguments');
  if (parsed.has('--porcelain') && !['v2', '2'].includes(parsed.get('--porcelain'))) {
    throw new GitError('Unsupported', 'CLI supports porcelain v2');
  }
  const records = await repo.status({ ignored: parsed.has('--ignored'), signal: context.signal });
  return writeResult(context, parsed, records, formatPorcelainV2(records, { nul: parsed.has('-z'), algorithm: repo.algorithm }));
}

async function addCommand(repo, args, parsed, context) {
  const paths = [...args, ...parsed.paths];
  const result = await repo.add(paths.length ? paths : ['.'], {
    update: parsed.has('--update') || parsed.has('-u'), force: parsed.has('--force') || parsed.has('-f'),
    intentToAdd: parsed.has('--intent-to-add') || parsed.has('-N'), signal: context.signal
  });
  return writeResult(context, parsed, result, '');
}

async function commitCommand(repo, args, parsed, context) {
  if (args.length || parsed.paths.length) throw new GitError('Unsupported', 'Stage selected paths with add before committing');
  const messages = parsed.ordered.filter(option => ['--message', '-m'].includes(option.name)).map(option => option.value);
  const env = context.env ?? process.env;
  const result = await repo.commit({
    message: messages.length ? messages.join('\n\n') : undefined,
    author: identity(repo, env, 'author', parsed), committer: identity(repo, env, 'committer', parsed),
    amend: parsed.has('--amend'), allowEmpty: parsed.has('--allow-empty'), allowEmptyMessage: parsed.has('--allow-empty-message'),
    signal: context.signal
  });
  return writeResult(context, parsed, result, `${result.oid}\n`);
}

async function logCommand(repo, args, parsed, context) {
  if (args.length > 1 || parsed.paths.length > 1) throw new GitError('Corrupt', 'Use log [REVISION] [-- PATH]');
  const result = (await repo.log({
    revision: args[0], path: parsed.paths[0], maxCount: numberOption(parsed.get('--max-count', parsed.get('-n', '100')), '--max-count'),
    skip: numberOption(parsed.get('--skip', '0'), '--skip'), all: parsed.has('--all'), follow: parsed.has('--follow'),
    firstParent: parsed.has('--first-parent'), reverse: parsed.has('--reverse'), author: parsed.get('--author'), search: parsed.get('--grep'),
    since: parsed.has('--since') ? timestamp(parsed.get('--since')).timestamp : undefined,
    until: parsed.has('--until') ? timestamp(parsed.get('--until')).timestamp : undefined, signal: context.signal
  })).map(compactCommit);
  const text = result.map(commit => parsed.has('--oneline') ? `${commit.oid.slice(0, 12)} ${commit.message.split('\n')[0]}\n`
    : `commit ${commit.oid}\n${commit.message.split('\n').map(line => `    ${line}`).join('\n')}\n`).join('\n');
  return writeResult(context, parsed, result, text);
}

async function diffCommand(repo, args, parsed, context) {
  if (args.length > 2) throw new GitError('Corrupt', 'Use diff [FROM] [TO] [-- PATH...]');
  const result = await repo.diff({
    from: args[0], to: args[1], staged: parsed.has('--staged') || parsed.has('--cached'), pathspec: parsed.paths,
    renames: !parsed.has('--no-renames'), patch: !parsed.has('--name-only') && !parsed.has('--name-status'), signal: context.signal
  });
  const text = result.map(change => parsed.has('--name-only') ? `${change.path}\n`
    : parsed.has('--name-status') ? `${change.status}${change.similarity ?? ''}\t${change.oldPath ? `${change.oldPath}\t` : ''}${change.path}\n`
    : change.patch ?? '').join('');
  return writeResult(context, parsed, result.map(({ oldText, newText, before, after, ...record }) => record), text);
}

async function revParseCommand(repo, args, parsed, context) {
  if (!args.length || parsed.paths.length) throw new GitError('Corrupt', 'Use rev-parse EXPRESSION...');
  const result = await Promise.all(args.map(expression => repo.revParse(expression, { signal: context.signal })));
  return writeResult(context, parsed, result, `${result.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n')}\n`);
}

async function blameCommand(repo, args, parsed, context) {
  const path = parsed.paths[0] ?? args.at(-1);
  if (!path || args.length > (parsed.paths.length ? 1 : 2) || parsed.paths.length > 1) {
    throw new GitError('Corrupt', 'Use blame [REVISION] -- PATH');
  }
  const revision = parsed.paths.length ? args[0] : args.length > 1 ? args[0] : undefined;
  const result = await repo.blame(path, { revision, signal: context.signal });
  return writeResult(context, parsed, result, result.map(line => `${line.oid} ${line.originalLine} ${line.finalLine}\t${line.text}\n`).join(''));
}

async function fsckCommand(repo, args, parsed, context) {
  if (parsed.paths.length) throw new GitError('Corrupt', 'Fsck does not accept paths');
  const result = await verifyRepositoryIntegrity(repo, { roots: args, reflogs: !parsed.has('--no-reflogs'),
    reportUnreachable: parsed.has('--unreachable') ? 'all' : true, signal: context.signal });
  const text = result.diagnostics.map(value => `${value.severity}: ${value.category} ${value.oid ?? value.ref ?? ''}\n`).join('');
  writeResult(context, parsed, result, text);
  return result.ok ? 0 : 1;
}

const handlers = Object.freeze({
  init: (repo, args, parsed, context) => writeResult(context, parsed, { algorithm: repo.algorithm }, `Initialized ${repo.algorithm} repository\n`),
  status: statusCommand, add: addCommand, commit: commitCommand, log: logCommand, diff: diffCommand, push: pushCommand,
  'rev-parse': revParseCommand, blame: blameCommand, fsck: fsckCommand
});

const usage = `SharpForge Git\nUsage: node apps/cli/git.js [-C DIRECTORY] COMMAND [OPTIONS]\n\n`
  + 'Commands: init, clone, status, add, commit, log, diff, push, rev-parse, blame, fsck\n'
  + 'Use --json for structured output, status -z for NUL-delimited porcelain v2.\n'
  + 'Network commands require --allow-origin https://HOST. Credentials additionally require\n'
  + '--allow-credential-origin ORIGIN and --authorization-env ENVIRONMENT_VARIABLE.\n';

/** Reusable CLI entry returning an exit code. Credentials and raw remote errors are never printed. */
export async function runGitCLI(argv, context = {}) {
  let parsed;
  try {
    parsed = parseArguments(argv);
    const [command, ...args] = parsed.positionals;
    if (!command || command === 'help' || parsed.has('--help') || parsed.has('-h')) { output(context, usage); return 0; }
    if (!commands.has(command)) throw new GitError('Unsupported', 'Unknown Git command');
    validateOptions(command, parsed);
    let directory = resolve(context.cwd ?? process.cwd(), parsed.get('-C', '.'));
    if (command === 'init') {
      if (args.length > 1 || parsed.paths.length) throw new GitError('Corrupt', 'Use init [DIRECTORY]');
      directory = resolve(directory, args[0] ?? '.');
    }
    if (command === 'clone') { await cloneCommand(args, parsed, context, directory); return 0; }
    const opened = await openRepository(directory, parsed, context, command === 'init');
    try {
      if (opened.bare && ['status', 'add', 'commit', 'diff'].includes(command)) {
        throw new GitError('Unsupported', `${command} requires a worktree`);
      }
      return await handlers[command](opened.repo, args, parsed, context) ?? 0;
    }
    finally { await opened.close(); }
  } catch (error) {
    const failure = error instanceof GitError ? error : GitError.from(error);
    const text = ['Auth', 'Network'].includes(failure.code) ? 'Git remote operation failed; check explicit origin and credential grants' : failure.message;
    const diagnostic = { code: failure.code, message: text };
    (context.stderr ?? process.stderr).write(parsed?.has('--json') ? `${JSON.stringify(diagnostic)}\n` : `${failure.code}: ${text}\n`);
    return 1;
  }
}

export const main = runGitCLI;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runGitCLI(process.argv.slice(2));
}
