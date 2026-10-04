// Starts only isolated loopback servers. It never replaces the Studio or Git implementations.
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureWorkspace } from '../git-conformance/native.js';
import { serveMode } from '../../scripts/conformance/serve-modes.js';
import { startCloneGitServer } from './a25-clone-git-server.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const records = {
  'CloneFixture.slnx': '<Solution><Project Path="App/App.csproj" /></Solution>\n',
  'App/App.csproj': '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType>'
    + '<TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>\n',
  'App/Program.cs': 'using System;\nclass Program {\n  static void Main() {\n'
    + '    Console.WriteLine("native clone fixture");\n  }\n}\n',
  'README.md': 'Canonical Git clone qualification, served by native git-http-backend.\n'
};
let workspace;
let remote;
let studio;
let input;
let closing;

async function start() {
  await access(resolve(root, 'dist/git-worker.js'));
  await access(resolve(root, 'dist/index.html'));
  workspace = await fixtureWorkspace('sharpforge-clone-browser-');
  const seed = resolve(workspace.root, 'seed');
  await workspace.git(['init', '--object-format=sha1', '--initial-branch=main', seed]);
  for (const [path, text] of Object.entries(records)) await workspace.write(seed, path, text);
  await workspace.git(['-C', seed, 'add', '.']);
  await workspace.git(['-C', seed, 'commit', '-m', 'Native C# solution fixture']);
  for (const name of ['public', 'private']) {
    await workspace.git(['clone', '--bare', seed, resolve(workspace.root, `${name}.git`)]);
  }
  const oid = (await workspace.git(['-C', seed, 'rev-parse', 'HEAD'])).text;
  const tree = (await workspace.git(['-C', seed, 'rev-parse', 'HEAD^{tree}'])).text;
  const version = (await workspace.git(['--version'])).text;
  remote = await startCloneGitServer({ directory: workspace.root, env: workspace.env,
    cert: resolve(root, 'tests/conformance/browser/fixtures/localhost-cert.pem'),
    key: resolve(root, 'tests/conformance/browser/fixtures/localhost-key.pem') });
  // Configure the unmodified production server before it starts. This grants only the fixture's remote origin in CSP.
  const previous = process.env.SHARPFORGE_CONNECT_ORIGINS;
  process.env.SHARPFORGE_CONNECT_ORIGINS = remote.origin;
  try { studio = await serveMode({ mode: 'http', root: resolve(root, 'dist') }); }
  finally {
    if (previous === undefined) delete process.env.SHARPFORGE_CONNECT_ORIGINS;
    else process.env.SHARPFORGE_CONNECT_ORIGINS = previous;
  }
  remote.allowOrigin(studio.url);
  process.stdout.write(`${JSON.stringify({ type: 'ready', studio: studio.url, remote: remote.origin,
    public: `${remote.origin}/public.git`, private: `${remote.origin}/private.git`, oid, tree, records,
    solution: 'CloneFixture.slnx', project: 'App/App.csproj', source: 'App/Program.cs', git: version, node: process.version })}\n`);
  input = createInterface({ input: process.stdin });
  input.on('line', line => {
    try {
      const request = JSON.parse(line);
      if (request.action === 'observations') {
        process.stdout.write(`${JSON.stringify({ type: 'observations', requests: remote.observations(),
          diagnostics: remote.diagnostics() })}\n`);
      } else if (request.action === 'close') void stop();
      else throw new Error('Unknown fixture control request');
    } catch (error) { process.stderr.write(`${error.message}\n`); }
  });
}

function stop(code = 0) {
  return closing ??= (async () => {
    input?.close();
    await studio?.close();
    await remote?.close();
    await workspace?.dispose();
    process.exit(code);
  })().catch(error => { process.stderr.write(`${error.stack}\n`); process.exit(1); });
}

process.once('SIGTERM', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
start().catch(async error => { process.stderr.write(`${error.stack}\n`); await stop(1); });
