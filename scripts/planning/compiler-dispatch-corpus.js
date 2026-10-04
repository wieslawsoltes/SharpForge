import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseArgs, isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {filesUnder} from './golden-output.js';
import {isMain} from './lib/io.js';

const script = fileURLToPath(import.meta.url);
const json = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? {$bigint: String(item)} : item);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function run(args, cwd) {
  const result = spawnSync(process.execPath, args, {cwd, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 300000});
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || `Capture exited ${result.status}`);
}

/** Each capture runs in its own process so package/module caches cannot mix the two worktrees. */
async function capture(root, destination) {
  const [{compileToIL}, {serializeImage}] = await Promise.all([
    import(pathToFileURL(resolve(root, 'packages/compiler/src/index.js'))),
    import(pathToFileURL(resolve(root, 'packages/bytecode/src/index.js')))
  ]);
  mkdirSync(destination, {recursive: true});
  const rows = [];
  for (const input of filesUnder(root, 'examples').filter(file => file.endsWith('.cs'))) {
    const text = readFileSync(resolve(root, input), 'utf8');
    for (const pipeline of ['legacy', 'bound']) {
      const result = compileToIL([{uri: input, text, version: 0}], {pipeline});
      const artifacts = {diagnostics: json(result.diagnostics)};
      if (result.success) {
        artifacts.assembly = result.assembly;
        artifacts.pdb = result.pdb;
        artifacts.image = serializeImage(result.image);
      }
      const files = {};
      for (const [kind, bytes] of Object.entries(artifacts)) {
        if (bytes === null) continue;
        const name = `${rows.length}.${kind}`;
        writeFileSync(join(destination, name), bytes);
        files[kind] = name;
      }
      rows.push({input, pipeline, source: hash(text), success: result.success, files});
    }
  }
  if (!rows.length || !rows.some(row => row.success)) throw new Error('No emitted examples in corpus');
  writeFileSync(join(destination, 'manifest.json'), json(rows));
}

/** Compare raw artifact bytes, including diagnostics for intentionally non-emitting example fragments. */
function compare(before, after) {
  const read = directory => JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  const beforeRows = read(before), afterRows = read(after), changes = [];
  const key = row => `${row.pipeline}:${row.input}`;
  const beforeMap = new Map(beforeRows.map(row => [key(row), row]));
  const afterMap = new Map(afterRows.map(row => [key(row), row]));
  for (const identity of new Set([...beforeMap.keys(), ...afterMap.keys()])) {
    const left = beforeMap.get(identity), right = afterMap.get(identity);
    if (!left || !right) { changes.push({identity, reason: 'corpus membership changed'}); continue; }
    if (left.source !== right.source || left.success !== right.success ||
        !isDeepStrictEqual(Object.keys(left.files), Object.keys(right.files))) {
      changes.push({identity, reason: 'input, success or artifact set changed'});
      continue;
    }
    for (const kind of Object.keys(left.files)) {
      const oldBytes = readFileSync(join(before, left.files[kind]));
      const newBytes = readFileSync(join(after, right.files[kind]));
      if (!oldBytes.equals(newBytes)) changes.push({identity, kind, before: hash(oldBytes), after: hash(newBytes)});
    }
  }
  return {passed: changes.length === 0, examples: beforeRows.length / 2,
    compilations: beforeRows.length, emitted: beforeRows.filter(row => row.success).length, changes};
}

if (isMain(import.meta.url)) {
  const {values} = parseArgs({options: {
    before: {type: 'string'}, after: {type: 'string'}, output: {type: 'string'},
    capture: {type: 'string'}, destination: {type: 'string'}
  }});
  if (values.capture && values.destination) {
    await capture(resolve(values.capture), resolve(values.destination));
  } else {
    if (!values.before || !values.after) throw new Error('Use --before BASE_WORKTREE --after CURRENT_WORKTREE [--output REPORT]');
    const temporary = mkdtempSync(join(tmpdir(), 'sharpforge-dispatch-'));
    try {
      const before = join(temporary, 'before'), after = join(temporary, 'after');
      run([script, '--capture', resolve(values.before), '--destination', before], resolve(values.before));
      run([script, '--capture', resolve(values.after), '--destination', after], resolve(values.after));
      const report = {...compare(before, after), scope: 'Node: legacy and bound compiler; PE, PDB, bytecode and diagnostics',
        deferredTargets: ['Browser engines', '.NET', 'Rust native', 'Rust Wasm', 'Performance benchmarks']};
      const output = JSON.stringify(report, null, 2) + '\n';
      if (values.output) writeFileSync(resolve(values.output), output);
      process.stdout.write(output);
      if (!report.passed) process.exitCode = 1;
    } finally {
      rmSync(temporary, {recursive: true, force: true});
    }
  }
}
