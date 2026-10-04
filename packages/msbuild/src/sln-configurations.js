import {readLegacySolution} from '@sharpforge/project-system';
import {splitSolutionConfiguration} from './solution-defaults.js';

/** Read legacy ActiveCfg/Build.0/Deploy.0 mappings without inferring build selection from ActiveCfg. */
export function readSlnConfigurations(source, options = {}) {
  const {path = 'Workspace.sln', signal} = options;
  const solution = readLegacySolution(source, path);
  const projects = solution.projects.map(project => ({...project, configurations: Object.create(null), dependencies: [...project.dependencies ?? []]}));
  const byId = new Map(projects.map(project => [project.id.toLowerCase(), project]));
  const configurations = [];
  const seen = new Set();
  let section = '';
  for (const line of source.split(/\r?\n/)) {
    signal?.throwIfAborted();
    const start = /^\s*GlobalSection\(([^)]+)\)/.exec(line);
    if (start) { section = start[1]; continue; }
    if (/^\s*EndGlobalSection/.test(line)) { section = ''; continue; }
    if (section === 'SolutionConfigurationPlatforms') {
      const match = /^\s*([^=]+?)\s*=\s*(.+?)\s*$/.exec(line);
      if (!match) { if (line.trim()) throw new Error('Malformed solution configuration entry'); continue; }
      const configuration = splitSolutionConfiguration(match[1]);
      if (seen.has(configuration.name.toLowerCase())) throw new Error('Duplicate solution configuration');
      if (configurations.length >= 4096) throw new Error('Solution configuration limit exceeded');
      seen.add(configuration.name.toLowerCase());
      configurations.push(configuration);
    } else if (section === 'ProjectConfigurationPlatforms') {
      const match = /^\s*\{([\da-f-]+)\}\.(.+)\.(ActiveCfg|Build\.0|Deploy\.0)\s*=\s*(.+?)\s*$/i.exec(line);
      if (!match) { if (line.trim()) throw new Error('Malformed project configuration entry'); continue; }
      const project = byId.get(match[1].toLowerCase());
      if (!project) throw new Error('Configuration references an unknown project GUID');
      const key = splitSolutionConfiguration(match[2]).name.toLowerCase();
      const mapped = splitSolutionConfiguration(match[4]);
      const entry = project.configurations[key] ??= {configuration: null, platform: null, build: false, deploy: false};
      if (match[3].toLowerCase() === 'activecfg') Object.assign(entry,
        {configuration: mapped.configuration, platform: mapped.platform === 'Any CPU' ? 'AnyCPU' : mapped.platform});
      else entry[match[3].toLowerCase().startsWith('build') ? 'build' : 'deploy'] = true;
    }
  }
  const names = new Map(configurations.map(configuration => [configuration.name.toLowerCase(), configuration.name]));
  for (const project of projects) {
    project.configurations = Object.fromEntries(Object.entries(project.configurations).map(([name, value]) => [names.get(name) ?? name, value]));
  }
  return {...solution, format: 'sln', projects, configurations};
}
