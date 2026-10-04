import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const fail = message => { throw new Error('Oracle license policy: ' + message); };
const canonical = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const exact = (actual, expected, label) => { if (canonical(actual) !== canonical(expected)) fail(label + ' differs from the reviewed catalog'); };
const reference = value => typeof value === 'string' && /^https:\/\//.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const named = (values, key, label) => {
  if (!Array.isArray(values)) fail(label + ' must be an array');
  const result = new Map();
  for (const value of values) {
    const name = key(value);
    if (typeof name !== 'string' || !name || result.has(name)) fail('duplicate or invalid ' + label);
    result.set(name, value);
  }
  return result;
};

export function readInputs(root = repository) {
  const read = file => readFileSync(path.join(root, file), 'utf8');
  return { catalog: JSON.parse(read('planning/qualification/oracle-licenses.json')),
    pin: JSON.parse(read('planning/qualification/oracle-toolchain.json')),
    lock: JSON.parse(read('tests/conformance/oracle/WinUI/packages.lock.json')),
    project: read('tests/conformance/oracle/WinUI/Oracle.WinUI.csproj'),
    workflows: { oracles: read('.github/workflows/oracles.yml'), measure: read('.github/workflows/winui-measure.yml') } };
}

export function validateCatalog({ catalog, pin, lock, project, workflows }) {
  if (catalog?.schemaVersion !== 1 || !catalog.policies || !catalog.pathPolicy) fail('unsupported or incomplete catalog');
  const policy = row => {
    const entry = catalog.policies[row.policy];
    if (!entry || !['cache', 'repository', 'redistribution'].every(key => typeof entry[key] === 'string' && entry[key])) fail('missing distribution policy');
  };
  const tools = named(catalog.tools, row => row?.id, 'tool');
  const sdkReferences = [...project.matchAll(/<WindowsSdkPackageVersion>\s*([^<\s]+)\s*<\/WindowsSdkPackageVersion>/g)].map(row => row[1]);
  if (sdkReferences.length !== 1) fail('Windows SDK reference pin must be explicit');
  const nodes = source => [...new Set([...source.matchAll(/^\s*node-version:\s*['"]?([0-9.]+)['"]?\s*$/gm)].map(row => row[1]))];
  const historicalNodes = nodes(workflows.oracles), measurementNodes = nodes(workflows.measure);
  if (historicalNodes.length !== 1 || measurementNodes.length !== 1) fail('workflow Node pins must be explicit');
  const expectedTools = { 'dotnet-sdk': pin.sdk, roslyn: pin.roslyn.version, coreclr: pin.runtime, 'reference-pack': pin.referencePack,
    'windows-sdk-net-ref': sdkReferences[0], 'node-oracles': historicalNodes[0], 'node-winui-measure': measurementNodes[0] };
  exact([...tools.keys()].sort(), Object.keys(expectedTools).sort(), 'tool inventory');
  for (const [id, version] of Object.entries(expectedTools)) {
    const row = tools.get(id); exact(row.version, version, id); policy(row);
    if (!reference(row.sourceLicense) && !reference(row.binaryTerms?.url)) fail('missing license reference for ' + id);
  }
  const expectedPackages = new Map();
  if (lock.version !== 1 || !lock.dependencies) fail('unsupported NuGet lock');
  for (const group of Object.values(lock.dependencies)) for (const [id, row] of Object.entries(group)) {
    if (!row.resolved || !row.contentHash) fail('unresolved NuGet package ' + id);
    const key = id + '@' + row.resolved;
    if (expectedPackages.has(key)) exact(expectedPackages.get(key), row.contentHash, 'repeated NuGet package ' + key);
    expectedPackages.set(key, row.contentHash);
  }
  const packages = named(catalog.packages, row => row && row.id + '@' + row.version, 'NuGet package');
  exact([...packages.keys()].sort(), [...expectedPackages.keys()].sort(), 'NuGet dependency inventory');
  for (const [key, contentHash] of expectedPackages) {
    const row = packages.get(key), license = row.license; policy(row); exact(row.contentHash, contentHash, key + ' content hash');
    if (!reference(row.packageUrl) || !reference(license?.url)) fail('missing package license reference for ' + key);
    if (license.kind === 'package-file') {
      if (!hash(license.sha256) || !/^[A-Za-z0-9_.-]+$/.test(license.path ?? '')) fail('invalid package license file for ' + key);
    } else if (license.kind === 'external-terms') {
      if (!hash(license.sha256) || !reference(license.declaredUrl)) fail('unbound external terms for ' + key);
    } else if (license.kind !== 'expression' || !license.expression) fail('unknown license declaration for ' + key);
  }
  exact(packages.get('Microsoft.WindowsAppSDK@' + pin.windowsAppSDK)?.version, pin.windowsAppSDK, 'Windows App SDK pin');
  const actions = named(catalog.actions, row => row?.uses, 'workflow action');
  const used = [...new Set(Object.values(workflows).flatMap(source => [...source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)\s*(?:#.*)?$/gm)].map(row => row[1])))].sort();
  exact([...actions.keys()].sort(), used, 'workflow action inventory');
  for (const [uses, row] of actions) {
    policy(row);
    if (!/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/.test(uses)) fail('workflow action must have an immutable source reference');
    const [name, revision] = uses.split('@');
    exact(row.sourceLicense, `https://github.com/${name}/blob/${revision}/LICENSE`, uses + ' license source');
  }
  const images = named(catalog.images, row => row?.id, 'image');
  exact([...images.keys()].sort(), Object.keys(pin.images).sort(), 'image inventory');
  for (const [id, row] of images) {
    policy(row); exact(row.pin, pin.images[id], id + ' image pin');
    if (!Array.isArray(row.terms) || !row.terms.length || !row.terms.every(reference)) fail('missing image access/component terms');
  }
  const paths = catalog.pathPolicy;
  for (const key of ['protectedRoots', 'binaryExtensions', 'toolBasenames', 'packagePrefixes']) {
    if (!Array.isArray(paths[key]) || !paths[key].length || !paths[key].every(value => typeof value === 'string' && value)) fail('missing path filter ' + key);
  }
  const exceptions = named(paths.authoredBinaryExceptions, row => row?.path, 'authored binary exception');
  for (const [file, row] of exceptions) {
    if (!hash(row.sha256) || typeof row.source !== 'string' || !row.source || row.source === file || typeof row.reason !== 'string' || !row.reason.trim()) fail('incomplete authored binary provenance');
  }
  return { tools: tools.size, packages: packages.size, actions: actions.size, images: images.size };
}

export function filterPaths(entries, catalog, readBlob = () => fail('missing authored fixture bytes')) {
  const rules = catalog.pathPolicy;
  const roots = rules.protectedRoots.map(value => value.toLowerCase());
  const extensions = rules.binaryExtensions.map(value => value.toLowerCase());
  const names = new Set(rules.toolBasenames.map(value => value.toLowerCase()));
  const prefixes = rules.packagePrefixes.map(value => value.toLowerCase());
  const exceptions = new Map(rules.authoredBinaryExceptions.map(row => [row.path, row]));
  const tracked = new Map(entries.map(row => [row.path, row]));
  const rejected = [];
  for (const entry of entries) {
    const normalized = entry.path.replaceAll('\\', '/').toLowerCase();
    const name = normalized.split('/').at(-1), protectedPath = roots.some(root => normalized === root.slice(0, -1) || normalized.startsWith(root));
    const binary = extensions.some(extension => name.endsWith(extension));
    const upstream = names.has(name) || (binary && prefixes.some(prefix => name.startsWith(prefix)));
    if (upstream) { rejected.push({ path: entry.path, reason: 'upstream oracle tool/package payload' }); continue; }
    if (!protectedPath) continue;
    if (entry.mode === '120000' || entry.mode === '160000') { rejected.push({ path: entry.path, reason: 'oracle paths must not redirect through symlinks or submodules' }); continue; }
    if (!binary) continue;
    const exception = exceptions.get(entry.path), source = exception && tracked.get(exception.source);
    if (exception && source && ['100644', '100755'].includes(source.mode) &&
        createHash('sha256').update(readBlob(entry)).digest('hex') === exception.sha256) continue;
    rejected.push({ path: entry.path, reason: 'binary/archive in oracle source, corpus or expected store without exact authored provenance' });
  }
  return rejected;
}

export function checkRepository(root = repository) {
  const inputs = readInputs(root), inventory = validateCatalog(inputs);
  const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  const entries = git(['ls-tree', '-r', '-z', '--full-tree', 'HEAD']).toString('utf8').split('\0').filter(Boolean).map(row => {
    const match = /^(\d+) (blob|commit) ([a-f0-9]+)\t([\s\S]+)$/.exec(row);
    if (!match) fail('invalid Git tree entry');
    return { mode: match[1], object: match[3], path: match[4] };
  });
  const rejected = filterPaths(entries, inputs.catalog, entry => git(['cat-file', 'blob', entry.object]));
  if (rejected.length) fail(rejected.map(row => row.path + ': ' + row.reason).join('\n'));
  return { status: 'passed', ...inventory, trackedPaths: entries.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) fail('usage: node scripts/conformance/oracle/license-policy.js');
    console.log(JSON.stringify(checkRepository()));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
