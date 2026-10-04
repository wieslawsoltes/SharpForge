import {mapSlnxProject, readSlnxConfigurations} from './solution-configurations.js';
import {canonicalSolutionPlatform} from './solution-defaults.js';
import {readSlnConfigurations} from './sln-configurations.js';

/** Convert one solution selection into explicit per-project global properties and build/deploy participation. */
export function selectSolutionProjects(model, options = {}) {
  const {configuration = model.configurations[0]?.configuration ?? 'Debug', platform = model.configurations[0]?.platform ?? 'Any CPU',
    action = 'build', projectPath, signal} = options;
  if (!['build', 'deploy', 'evaluate', 'rebuild', 'clean'].includes(action)) throw new Error('Unsupported solution selection action');
  const selected = model.configurations.find(value => value.configuration.toLowerCase() === configuration.toLowerCase() &&
    canonicalSolutionPlatform(value.platform) === canonicalSolutionPlatform(platform));
  if (!selected) throw Object.assign(new Error('Unknown solution configuration: ' + configuration + '|' + platform), {code: 'SFM2303'});
  const projectProperties = Object.create(null);
  const projects = model.projects.map(project => {
    signal?.throwIfAborted();
    const mapping = model.format === 'sln' ? project.configurations[selected.name] ??
      {configuration: null, platform: null, build: false, deploy: false} : mapSlnxProject(project, selected);
    const globalProperties = {};
    if (mapping.configuration !== null) globalProperties.Configuration = mapping.configuration;
    if (mapping.platform !== null) globalProperties.Platform = mapping.platform;
    projectProperties[project.path] = globalProperties;
    return {...project, ...mapping, globalProperties, selected: (!projectPath || project.path === projectPath) &&
      (action === 'evaluate' || action === 'deploy' ? action === 'evaluate' || mapping.deploy : mapping.build)};
  });
  if (projectPath && !projects.some(project => project.path === projectPath)) throw new Error('Project does not belong to solution');
  return {configuration: selected.configuration, platform: selected.platform, projects, projectProperties};
}

/** UI configuration-manager rows retain excluded and unsupported projects so saving never drops them. */
export function createSolutionConfigurationManager(model, options = {}) {
  return {configurations: model.configurations.map(value => ({...value})), ...selectSolutionProjects(model, {...options, action: 'evaluate'})};
}

/** A project build in solution context uses the mapped project properties, even when Build is disabled globally. */
export function solutionProjectBuildRequest(model, request) {
  const selected = selectSolutionProjects(model, {...request, configuration: request.solutionConfiguration ?? request.configuration,
    platform: request.solutionPlatform ?? request.platform, projectPath: request.project, action: 'evaluate'});
  const project = selected.projects.find(value => value.path === request.project);
  if (!project.configuration || project.platform === null) throw new Error('Project has no active solution configuration');
  return {...request, configuration: project.configuration, platform: project.platform,
    properties: {...request.properties, ...project.globalProperties}, solution: model.path,
    solutionConfiguration: selected.configuration, solutionPlatform: selected.platform};
}

/** Resolve a single-project request against its saved solution before native scheduling; the caller authorizes disk access first. */
export async function resolveSolutionBuildRequest(workspace, request, options = {}) {
  if (!request.solution || /\.slnx?$/i.test(request.project)) return request;
  if (typeof request.solution !== 'string' || !/\.slnx?$/i.test(request.solution)) throw new Error('Invalid solution context path');
  options.signal?.throwIfAborted();
  const source = await workspace.read(request.solution);
  options.signal?.throwIfAborted();
  const model = /\.slnx$/i.test(request.solution) ? readSlnxConfigurations(source.text, {path: request.solution, signal: options.signal}) :
    readSlnConfigurations(source.text, {path: request.solution, signal: options.signal});
  return solutionProjectBuildRequest(model, request);
}
