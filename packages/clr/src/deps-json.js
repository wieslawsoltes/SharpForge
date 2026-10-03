import { checkCancellation, loadError, LoadErrorCode } from './load-errors.js';
import { combineAssetPath, relativeAssetPath, runtimeFallbacks } from './probing-paths.js';

function configuration(value, name) {
  if (typeof value === 'string') {
    if (value.length > 8 * 1024 * 1024) throw loadError(LoadErrorCode.LimitExceeded, `${name} exceeds 8 MiB`);
    try { value = JSON.parse(value); }
    catch { throw loadError(LoadErrorCode.InvalidConfiguration, `Invalid ${name} JSON`); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw loadError(LoadErrorCode.InvalidConfiguration, `${name} must be an object`);
  }
  return value;
}

function selectedAssets(library, fallback) {
  const assets = new Map(Object.entries(library.runtime ?? {}).map(([path, info]) => [path.split('/').at(-1), { path, info }]));
  const ranked = new Map(fallback.map((rid, index) => [rid, index]));
  const choices = new Map();
  for (const [path, info] of Object.entries(library.runtimeTargets ?? {})) {
    if (info.assetType !== 'runtime' || !ranked.has(info.rid)) continue;
    const name = path.split('/').at(-1);
    const rank = ranked.get(info.rid);
    if (!choices.has(name) || rank < choices.get(name).rank) choices.set(name, { path, info, rank });
  }
  for (const [name, choice] of choices) assets.set(name, choice);
  return [...assets.values()];
}

/** Interpret deps/runtimeconfig data without opening paths or probing the host filesystem. */
export function readDependencyManifest(depsInput, runtimeConfigInput = {}, options = {}) {
  const { appRoot = '', packageRoot = '', rid = null, target = null, maxAssets = 20000, signal } = options;
  checkCancellation(signal);
  if (!Number.isSafeInteger(maxAssets) || maxAssets < 1) throw new RangeError('Invalid asset limit');
  const deps = configuration(depsInput, 'deps.json');
  const config = configuration(runtimeConfigInput, 'runtimeconfig.json');
  const targetName = target ?? deps.runtimeTarget?.name ?? Object.keys(deps.targets ?? {})[0];
  if (!targetName || !Object.hasOwn(deps.targets ?? {}, targetName)) {
    throw loadError(LoadErrorCode.InvalidConfiguration, 'Dependency target does not exist');
  }
  const runtime = config.runtimeOptions ?? {};
  const selectedRid = rid ?? (targetName.includes('/') ? targetName.slice(targetName.lastIndexOf('/') + 1) : null);
  const fallbacks = runtimeFallbacks(selectedRid, deps.runtimes);
  const assemblies = [];
  const names = new Map();
  for (const [libraryName, library] of Object.entries(deps.targets[targetName])) {
    checkCancellation(signal);
    const record = deps.libraries?.[libraryName];
    if (!record) throw loadError(LoadErrorCode.InvalidConfiguration, `Missing library record: ${libraryName}`);
    for (const asset of selectedAssets(library, fallbacks)) {
      relativeAssetPath(asset.path);
      if (asset.path.endsWith('/_._') || !/\.dll$/i.test(asset.path)) continue;
      if (assemblies.length === maxAssets) throw loadError(LoadErrorCode.LimitExceeded, 'Trusted assembly list limit exceeded');
      const packagePath = record.type === 'package' && packageRoot ? `${record.path ?? libraryName.toLowerCase()}/${asset.path}` : null;
      const path = packagePath ? combineAssetPath(packageRoot, packagePath) : combineAssetPath(appRoot, asset.path.split('/').at(-1));
      const name = asset.path.split('/').at(-1).slice(0, -4);
      if (names.has(name.toLowerCase())) throw loadError(LoadErrorCode.ConflictingAssembly, `Duplicate trusted assembly: ${name}`);
      names.set(name.toLowerCase(), path);
      assemblies.push(Object.freeze({ name, path, library: libraryName, assemblyVersion: asset.info.assemblyVersion ?? null }));
    }
  }
  return Object.freeze({
    target: targetName, rid: selectedRid, fallbacks: Object.freeze(fallbacks), assemblies: Object.freeze(assemblies),
    framework: runtime.framework ? Object.freeze({ ...runtime.framework }) : null,
    frameworks: Object.freeze((runtime.frameworks ?? []).map(framework => Object.freeze({ ...framework }))),
    rollForward: runtime.rollForward ?? 'Minor',
    probingPaths: Object.freeze([...(runtime.additionalProbingPaths ?? [])]),
    properties: Object.freeze({ ...(runtime.configProperties ?? {}) }),
  });
}
