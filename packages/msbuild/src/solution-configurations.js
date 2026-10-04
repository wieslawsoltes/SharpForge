import {parseXml, normalizePath, directoryName} from '@sharpforge/project-system';
import {inferProjectConfiguration, canonicalSolutionPlatform, solutionConfigurationName, splitSolutionConfiguration} from './solution-defaults.js';

const dimensions = Object.freeze({BuildType: 'configuration', Platform: 'platform', Build: 'build', Deploy: 'deploy'});
const records = node => ({element: node.name, attributes: {...node.attributes}, children: node.children.map(records)});

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  throw Object.assign(new Error('Expected a boolean solution rule'), {code: 'SFM2302'});
}

function parseRules(node) {
  return node.children.filter(child => Object.hasOwn(dimensions, child.name)).map(child => {
    const solution = child.attributes.Solution ?? '';
    const pattern = !solution || solution === '*' ? {configuration: '*', platform: '*'} : splitSolutionConfiguration(solution);
    const dimension = dimensions[child.name];
    const value = ['build', 'deploy'].includes(dimension) ? bool(child.attributes.Project, true) : child.attributes.Project;
    if (value === undefined || value === '') throw new Error('A solution mapping requires a Project value');
    return {dimension, configuration: pattern.configuration, platform: pattern.platform, value};
  });
}

function matchingType(project, types) {
  return types.find(type => project.type && [type.name, type.id].some(value => value?.toLowerCase() === project.type.toLowerCase())) ??
    types.find(type => type.extension && project.path.toLowerCase().endsWith(type.extension.toLowerCase()));
}

function typeRules(project, types, seen = new Set()) {
  const type = matchingType(project, types);
  if (!type) return [];
  if (seen.has(type)) throw new Error('Solution ProjectType inheritance cycle');
  seen.add(type);
  const inherited = type.basedOn ? typeRules({...project, type: type.basedOn, path: ''}, types, seen) : [];
  const defaults = [];
  if (type.isBuildable !== undefined) defaults.push({dimension: 'build', configuration: '*', platform: '*', value: type.isBuildable});
  if (type.supportsPlatform === false) defaults.push({dimension: 'platform', configuration: '*', platform: '*', value: '?'});
  return [...inherited, ...defaults, ...type.rules];
}

/** Parse the native .slnx configuration model while preserving unknown project metadata for subsequent writes. */
export function readSlnxConfigurations(source, options = {}) {
  const {path = 'Workspace.slnx', maxProjects = 10_000, signal} = options;
  signal?.throwIfAborted();
  const root = parseXml(source, {maxLength: 4_000_000, maxNodes: 100_000});
  if (root.name !== 'Solution') throw new Error('Expected Solution XML root');
  const base = directoryName(normalizePath(path));
  const model = {path, format: 'slnx', configurations: [], projects: [], folders: [], files: [], projectTypes: [], diagnostics: []};
  const groups = root.children.filter(node => node.name === 'Configurations');
  if (groups.length > 1) throw new Error('Duplicate solution Configurations element');
  const values = groups.flatMap(node => node.children);
  const buildTypes = values.filter(node => node.name === 'BuildType').map(node => node.attributes.Name);
  const platforms = values.filter(node => node.name === 'Platform').map(node => node.attributes.Name);
  if ((buildTypes.length || 2) * (platforms.length || 1) > 4096) {
    throw new Error('Solution configuration limit exceeded');
  }
  for (const configuration of buildTypes.length ? buildTypes : ['Debug', 'Release']) {
    for (const platform of platforms.length ? platforms : ['Any CPU']) {
      model.configurations.push({name: solutionConfigurationName(configuration, platform), configuration, platform});
    }
  }
  if (new Set(model.configurations.map(value => value.name.toLowerCase())).size !== model.configurations.length) {
    throw new Error('Duplicate solution configuration');
  }
  model.projectTypes = values.filter(node => node.name === 'ProjectType').map(node => ({name: node.attributes.Name,
    id: node.attributes.TypeId, extension: node.attributes.Extension, basedOn: node.attributes.BasedOn, rules: parseRules(node),
    isBuildable: node.attributes.IsBuildable === undefined ? undefined : bool(node.attributes.IsBuildable),
    supportsPlatform: node.attributes.SupportsPlatform === undefined ? undefined : bool(node.attributes.SupportsPlatform)}));
  const seen = new Set();
  const visit = (node, folder = '') => {
    signal?.throwIfAborted();
    for (const child of node.children) {
      if (child.name === 'Folder') {
        const raw = child.attributes.Name;
        if (!raw || raw.split('/').includes('..')) throw new Error('Invalid solution folder');
        const name = raw.startsWith('/') ? raw : folder + '/' + raw;
        model.folders.push({name: name.replace(/\/+/g, '/')});
        visit(child, name);
      } else if (child.name === 'Project') {
        if (model.projects.length >= maxProjects) throw new Error('Solution project limit exceeded');
        const projectPath = normalizePath(child.attributes.Path ?? '', base);
        if (seen.has(projectPath.toLowerCase())) throw new Error('Duplicate solution project path');
        seen.add(projectPath.toLowerCase());
        const project = {path: projectPath, folder, type: child.attributes.Type ?? '', displayName: child.attributes.DisplayName,
          rules: parseRules(child), attributes: {...child.attributes}, metadata: child.children.filter(value => value.name === 'Properties').map(records),
          dependencies: child.children.filter(value => value.name === 'BuildDependency')
            .map(value => normalizePath(value.attributes.Project ?? '', base)), supported: /\.csproj$/i.test(projectPath)};
        project.unloaded = !project.supported;
        project.reason = project.supported ? null : 'This project requires its native toolchain';
        project.typeRules = typeRules(project, model.projectTypes);
        model.projects.push(project);
      } else if (child.name === 'File') model.files.push({path: normalizePath(child.attributes.Path ?? '', base), folder});
    }
  };
  visit(root);
  return model;
}

/** Rules are evaluated in declaration order; the last matching value wins, as in SolutionPersistence. */
export function mapSlnxProject(project, selected) {
  const result = inferProjectConfiguration(project, selected);
  for (const rule of [...project.typeRules ?? [], ...project.rules ?? []]) {
    const buildMatches = rule.configuration === '*' || rule.configuration.toLowerCase() === selected.configuration.toLowerCase();
    const platformMatches = rule.platform === '*' || canonicalSolutionPlatform(rule.platform) === canonicalSolutionPlatform(selected.platform);
    if (!buildMatches || !platformMatches) continue;
    const value = rule.value === '*' ? selected[rule.dimension] : rule.value;
    result[rule.dimension] = value === '?' ? null : value;
  }
  if (canonicalSolutionPlatform(result.platform ?? '') === 'anycpu') result.platform = 'AnyCPU';
  return result;
}
