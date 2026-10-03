import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { dynamicCodeUses } from './code-tokens.js';

export function sourceFiles(root, directories = ['packages', 'apps', 'scripts', 'tests', 'planning', 'examples']) {
  const files = [];
  const visit = directory => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', '.git', 'obj', 'bin', 'artifacts', 'dist'].includes(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.(?:mjs|js)$/.test(entry.name)) files.push(relative(root, path).split(sep).join('/'));
    }
  };
  directories.forEach(directory => visit(resolve(root, directory))); return files.sort();
}

export function checkDynamicUses(root, paths, policy) {
  if (policy.schemaVersion !== 1 || !Array.isArray(policy.allow)) throw new Error('Invalid dynamic-code policy');
  const errors = [], observed = [], used = new Set(), keys = new Set();
  for (const entry of policy.allow) {
    const key = entry.path + ':' + entry.operation;
    if (keys.has(key) || !/^[a-f0-9]{64}$/.test(entry.sha256) || !entry.reason?.trim() ||
      !Number.isSafeInteger(entry.count) || entry.count < 1 || !['dynamic-import', 'eval', 'new-Function'].includes(entry.operation)) {
      throw new Error('Invalid or duplicate policy entry: ' + key);
    }
    keys.add(key);
  }
  for (const path of paths) {
    const source = readFileSync(resolve(root, path), 'utf8'), hash = createHash('sha256').update(source).digest('hex');
    const uses = dynamicCodeUses(source);
    for (const operation of new Set(uses.map(use => use.operation))) {
      const matching = uses.filter(use => use.operation === operation), entry = policy.allow.find(row => row.path === path && row.operation === operation);
      const record = { path, operation, sha256: hash, count: matching.length, lines: matching.map(use => use.line) };
      observed.push(record);
      if (!entry || entry.sha256 !== hash || entry.count !== matching.length) {
        errors.push({ ...record, message: 'Unreviewed dynamic-code use or changed file' });
      } else used.add(entry.path + ':' + entry.operation);
    }
  }
  for (const entry of policy.allow) if (!used.has(entry.path + ':' + entry.operation)) {
    errors.push({ path: entry.path, operation: entry.operation, message: 'Stale or mismatched allow-list entry' });
  }
  return { observed, errors };
}

export function checkImports({ root = process.cwd(), policy, directories, timeoutMs = 60000 } = {}) {
  root = resolve(root);
  policy ??= JSON.parse(readFileSync(resolve(root, 'scripts/conformance/static/allowlist.json'), 'utf8'));
  const paths = sourceFiles(root, directories), dynamic = checkDynamicUses(root, paths, policy);
  const worker = fileURLToPath(new URL('./link-modules.js', import.meta.url));
  const child = spawnSync(process.execPath, ['--experimental-vm-modules', worker, '--worker'], {
    input: JSON.stringify({ root, paths }), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs,
  });
  let link;
  try {
    if (child.status !== 0) throw new Error(child.error?.message ?? child.stderr ?? 'Module-link subprocess failed');
    link = JSON.parse(child.stdout);
  } catch (error) { link = { modules: [], errors: [{ path: '<linker>', message: error.message }] }; }
  return { schemaVersion: 1, passed: !dynamic.errors.length && !link.errors.length, inspected: paths.length,
    modules: link.modules.length, dynamicUses: dynamic.observed, errors: [...link.errors, ...dynamic.errors] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: 'string', default: process.cwd() }, output: { type: 'string' } } });
  const report = checkImports({ root: values.root }), text = JSON.stringify(report, null, 2) + '\n';
  if (values.output) { mkdirSync(dirname(resolve(values.output)), { recursive: true }); writeFileSync(values.output, text); }
  console.log(JSON.stringify({ passed: report.passed, inspected: report.inspected, modules: report.modules, errors: report.errors }, null, 2));
  if (!report.passed) process.exitCode = 1;
}
