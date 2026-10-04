import { EvaluationError, splitList, toBoolean } from './errors.js';

const list = value => splitList(String(value ?? '').replaceAll(',', ';'));

function propertyBoolean(properties, name, fallback = false) {
  const value = properties[name.toLowerCase()];
  if (value === undefined || value === '') return fallback;
  if (!/^(true|false)$/i.test(String(value).trim())) throw new EvaluationError(`Invalid ${name} value '${value}'.`, 'SFP1402');
  return String(value).trim().toLowerCase() === 'true';
}

/** Project-specific compiler options, with explicit validation and all policy-bearing values retained. */
export function projectCompilationOptions(project) {
  const properties = project.properties;
  const langVersion = String(properties.langversion ?? '14').trim().toLowerCase();
  const language = ['latest', 'latestmajor', 'default'].includes(langVersion) ? '14' : langVersion.replace(/\.0$/, '');
  if (!['preview', 'iso-1', 'iso-2'].includes(language) && !/^(?:[1-9]|1[0-4])(?:\.[0-3])?$/.test(language)) {
    throw new EvaluationError(`Invalid or unsupported LangVersion '${langVersion}' in ${project.path}.`, 'SFP1402');
  }
  const nullable = String(properties.nullable || 'disable').toLowerCase();
  if (!['disable', 'enable', 'warnings', 'annotations'].includes(nullable)) throw new EvaluationError('Invalid Nullable setting.', 'SFP1402');
  const defines = list(properties.defineconstants);
  if (defines.some(value => !/^[A-Za-z_]\w*$/.test(value))) throw new EvaluationError('Invalid DefineConstants identifier.', 'SFP1402');
  const warningLevel = Number(properties.warninglevel ?? 4);
  if (!Number.isSafeInteger(warningLevel) || warningLevel < 0) throw new EvaluationError('Invalid WarningLevel.', 'SFP1402');
  const noWarn = list(properties.nowarn);
  if (toBoolean(properties.usingmicrosoftnetsdk)) {
    if (!['v1.0', 'v1.1'].includes(properties.targetframeworkversion)) noWarn.push('1701', '1702');
    if (properties.targetframeworkidentifier === '.NETCoreApp') noWarn.push('8002');
  }
  return {
    outputKind: project.outputType.toLowerCase() === 'library' ? 'library' : 'exe',
    checkOverflow: propertyBoolean(properties, 'CheckForOverflowUnderflow'), langVersion: language,
    defines: [...new Set(defines)], preprocessorSymbols: [...new Set(defines)], nullable, nullableContext: nullable,
    allowUnsafe: propertyBoolean(properties, 'AllowUnsafeBlocks'),
    rootNamespace: properties.rootnamespace ?? project.name, warningLevel, noWarn: [...new Set(noWarn)],
    warningsAsErrors: list(properties.warningsaserrors), warningsNotAsErrors: list(properties.warningsnotaserrors),
    warnAsError: list(properties.warningsaserrors), warnNotAsError: list(properties.warningsnotaserrors),
    treatWarningsAsErrors: propertyBoolean(properties, 'TreatWarningsAsErrors'), optimize: propertyBoolean(properties, 'Optimize'),
    deterministic: propertyBoolean(properties, 'Deterministic', true), assemblyName: project.name, name: project.name,
    implicitGlobalUsings: project.generatedSources?.filter(source => source.kind === 'global-usings').map(source => source.text) ?? [],
  };
}

/** Compatibility options for source-combined callers; conflicting per-source policies are rejected. */
export function combinedCompilationOptions(system, startup) {
  const project = system.projects.get(startup);
  if (!project || project.unloaded) throw new EvaluationError('Startup project was not loaded.', 'SFP1402');
  const result = projectCompilationOptions(project);
  const perSource = Object.create(null);
  const checkOverflowByUri = Object.create(null);
  const langVersionByUri = Object.create(null);
  for (const path of system.closure(startup)) {
    const current = system.projects.get(path);
    if (!current || current.unloaded) continue;
    const options = projectCompilationOptions(current);
    const stamp = JSON.stringify(options);
    for (const item of [...current.compile, ...(current.generatedSources ?? [])]) {
      if (perSource[item.path] && perSource[item.path].stamp !== stamp) {
        const previous = perSource[item.path].options;
        const category = previous.checkOverflow !== options.checkOverflow ? 'overflow' : previous.langVersion !== options.langVersion
          ? 'language versions' : 'compilation settings';
        throw new EvaluationError(`Linked source '${item.path}' has conflicting ${category} in the source-combined build.`, 'SFP1402');
      }
      perSource[item.path] = { stamp, options };
      checkOverflowByUri[item.path] = options.checkOverflow;
      langVersionByUri[item.path] = options.langVersion;
    }
  }
  return { ...result, checkOverflowByUri, langVersionByUri,
    optionsByUri: Object.fromEntries(Object.entries(perSource).map(([path, value]) => [path, value.options])) };
}
