import { readZip } from '@sharpforge/archive';
import { parseXml, nearestTargetFramework } from '@sharpforge/project-system';
import { runtimeFallbacks } from '../rid.js';

export function readNuGetPackage(bytes, options = {}) {
  const files = readZip(bytes, options), specification = files.find(file => !file.directory && /^[^/]+\.nuspec$/i.test(file.path));
  if (!specification) throw new Error('NuGet package has no root nuspec');
  const root = parseXml(new TextDecoder('utf-8', { fatal: true }).decode(specification.bytes));
  const metadata = root.children.find(node => node.name === 'metadata');
  if (root.name !== 'package' || !metadata) throw new Error('Invalid nuspec package metadata');
  const properties = Object.fromEntries(metadata.children.filter(node => !node.children.length).map(node => [node.name, node.text]));
  const dependencies = metadata.children.find(node => node.name === 'dependencies');
  const groups = (dependencies?.children ?? []).map(node => node.name === 'group' ? {
    targetFramework: node.attributes.targetFramework ?? '',
    dependencies: node.children.map(item => ({ id: item.attributes.id, version: item.attributes.version ?? '' }))
  } : { targetFramework: '', dependencies: [{ id: node.attributes.id, version: node.attributes.version ?? '' }] });
  return { metadata: properties, dependencyGroups: groups, files };
}

/** Select nearest ref/lib and RID runtime groups. Caller supplies the same TFM reducer used by project evaluation. */
export function selectPackageAssets(packageData, targetFramework, { runtimeIdentifier = '', nearestFramework = nearestTargetFramework, runtimeGraph } = {}) {
  if (typeof nearestFramework !== 'function') throw new Error('Asset selection requires the project system TFM compatibility reducer');
  const paths = packageData.files.filter(file => !file.directory).map(file => file.path);
  function group(prefix) {
    const groups = new Map();
    for (const path of paths) {
      if (!path.startsWith(prefix + '/')) continue;
      const suffix = path.slice(prefix.length + 1), separator = suffix.indexOf('/');
      if (separator < 0) continue;
      const framework = suffix.slice(0, separator);
      if (!groups.has(framework)) groups.set(framework, []);
      groups.get(framework).push(path);
    }
    const selected = nearestFramework(targetFramework, [...groups.keys()]);
    return selected ? { framework: typeof selected === 'string' ? selected : selected.tfm ?? selected.original,
      paths: groups.get(typeof selected === 'string' ? selected : selected.tfm ?? selected.original) ?? [] } : { framework: null, paths: [] };
  }
  const references = group('ref'), libraries = group('lib');
  let runtime = libraries, native = [];
  if (runtimeIdentifier) {
    const fallback = runtimeFallbacks(runtimeIdentifier, runtimeGraph);
    if (fallback.diagnostics.length) return { diagnostics: fallback.diagnostics, compile: [], runtime: [], native: [] };
    for (const rid of fallback.runtimes) {
      const selected = group('runtimes/' + rid + '/lib');
      if (selected.framework) { runtime = selected; break; }
    }
    for (const rid of fallback.runtimes) {
      const matches = paths.filter(path => path.startsWith('runtimes/' + rid + '/native/'));
      if (matches.length) { native = matches; break; }
    }
  }
  const clean = values => values.filter(path => !path.endsWith('/_._'));
  return { diagnostics: [], compile: clean(references.framework ? references.paths : libraries.paths), runtime: clean(runtime.paths), native,
    analyzers: paths.filter(path => /^analyzers\/dotnet\/(?:cs\/)?[^/]+\.dll$/i.test(path)),
    build: [...paths.filter(path => /^build\/[^/]+\.(props|targets)$/i.test(path)), ...group('build').paths],
    contentFiles: paths.filter(path => path.startsWith('contentFiles/')) };
}
