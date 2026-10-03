import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { filesUnder, fixtureRoot, repoRoot } from './support/syntax-reference.js';

// SF-A01-T01.5: the Roslyn reference data is checked in and regenerates byte-identically.
//   <fixture>.cs.json           the tree Roslyn parses (compared with SharpForge's tree in syntax-reference-trees.test.js)
//   <fixture>.cs.roslyn.json    the diagnostics Roslyn reports when it compiles a rejected fixture
// Both come from packages/syntax/tools/roslyn-tree-export, built with the .NET SDK below (its Roslyn is the pinned one).
const pinnedSdk = '10.0.201';
const project = join(repoRoot, 'packages/syntax/tools/roslyn-tree-export');
const pinnedRoslyn = JSON.parse(readFileSync(join(fixtureRoot, 'reference/roslyn-features.json'), 'utf8')).roslyn;
const slash = path => path.replaceAll('\\', '/');
const name = file => slash(relative(fixtureRoot, file));
const isRejected = file => /(^|[\\/.])rejected\.cs$/.test(file);

// Preview syntax the pinned Roslyn build does not parse: SharpForge follows the language proposals for these, so there
// is no Roslyn tree to compare with. The list is exact: a fixture that gains or loses its dump must be moved.
const withoutRoslynTree = [
  'matrix/15-preview/ClosedClasses/positive.cs',
  'matrix/15-preview/ClosedEnums/positive.cs',
  'matrix/15-preview/CollectionExpressionArguments/positive.cs',
  'matrix/15-preview/LabeledBreakContinue/positive.cs',
  'matrix/15-preview/SafeModifier/positive.cs',
  'matrix/15-preview/Unions/positive.cs',
  'matrix/15-preview/UnsafeExpressions/positive.cs'
];

test('dumps: every matrix fixture has its Roslyn dump', () => {
  const matrix = filesUnder(join(fixtureRoot, 'matrix'));
  const positives = matrix.filter(file => !isRejected(file)),
    rejected = matrix.filter(isRejected);
  assert(positives.length >= 127 && positives.length === rejected.length, 'positive and rejected fixtures come in pairs');
  assert.deepEqual(positives.filter(file => !existsSync(file + '.json')).map(name), withoutRoslynTree);
  assert.deepEqual(rejected.filter(file => !existsSync(file + '.roslyn.json')).map(name), []);
  for (const file of filesUnder(join(fixtureRoot, 'gates'))) assert(existsSync(file + '.roslyn.json'), name(file));
});

test('dumps: every dump belongs to a fixture and names the pinned Roslyn build', () => {
  const dumps = filesUnder(fixtureRoot, entry => entry.endsWith('.cs.json') || entry.endsWith('.cs.roslyn.json'));
  assert(dumps.length >= 390, `expected at least 390 dumps, found ${dumps.length}`);
  for (const dump of dumps) {
    assert(existsSync(dump.replace(/(\.roslyn)?\.json$/, '')), 'no fixture for ' + name(dump));
    assert.equal(JSON.parse(readFileSync(dump, 'utf8')).roslyn, pinnedRoslyn, name(dump));
  }
});

/** The exporter to run: the built one, or one built into `scratch` when the pinned SDK is installed. Null when neither is possible. */
function exporter(scratch) {
  const version = spawnSync('dotnet', ['--version'], { encoding: 'utf8' });
  if (version.error || version.status !== 0) return { skip: 'the dotnet CLI is not installed' };
  const built = join(project, 'bin/Release/net10.0/roslyn-tree-export.dll');
  if (existsSync(built)) return { dll: built };
  if (version.stdout.trim() !== pinnedSdk) return { skip: `.NET SDK ${pinnedSdk} is not the active SDK (found ${version.stdout.trim()})` };
  // The sources are built in a copy, so the checkout stays clean and an existing obj directory cannot interfere.
  const copy = join(scratch, 'project'),
    output = join(scratch, 'bin');
  mkdirSync(copy, { recursive: true });
  for (const file of ['Program.cs', 'RejectedFixtureDiagnostics.cs', 'roslyn-tree-export.csproj']) cpSync(join(project, file), join(copy, file));
  const build = spawnSync('dotnet', ['build', join(copy, 'roslyn-tree-export.csproj'), '-c', 'Release', '-o', output, '-nologo'], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  return { dll: join(output, 'roslyn-tree-export.dll') };
}

test('dumps: regenerating with the pinned SDK is byte-identical', context => {
  const scratch = mkdtempSync(join(tmpdir(), 'sharpforge-roslyn-dumps-'));
  try {
    const tool = exporter(scratch);
    if (tool.skip) return context.skip(tool.skip);
    const run = (...args) => {
      const result = spawnSync('dotnet', [tool.dll, ...args], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      return result.stdout;
    };
    // Trees: every fixture is exported into the scratch directory. A build against another Roslyn is not a regeneration.
    const trees = join(scratch, 'trees'),
      reported = /with Roslyn (\S+)/.exec(run(fixtureRoot, trees))?.[1];
    if (reported !== pinnedRoslyn) return context.skip(`the exporter was built against Roslyn ${reported}, not the pinned ${pinnedRoslyn}`);
    const differing = [];
    let compared = 0;
    for (const dump of filesUnder(fixtureRoot, entry => entry.endsWith('.cs.json'))) {
      compared++;
      if (!readFileSync(dump).equals(readFileSync(join(trees, relative(fixtureRoot, dump))))) differing.push(name(dump));
    }
    // Compile diagnostics are written beside the fixtures, so the rejected fixtures are copied out first.
    const copies = join(scratch, 'rejected'),
      rejected = filesUnder(fixtureRoot).filter(isRejected);
    for (const file of rejected) {
      const copy = join(copies, relative(fixtureRoot, file));
      mkdirSync(dirname(copy), { recursive: true });
      cpSync(file, copy);
    }
    run('--rejected', copies);
    for (const file of rejected) {
      compared++;
      const regenerated = readFileSync(join(copies, relative(fixtureRoot, file)) + '.roslyn.json');
      if (!readFileSync(file + '.roslyn.json').equals(regenerated)) differing.push(name(file) + '.roslyn.json');
    }
    assert.deepEqual(differing, [], 'dumps that differ from a fresh export');
    assert(compared >= 390, `compared ${compared} dumps`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
