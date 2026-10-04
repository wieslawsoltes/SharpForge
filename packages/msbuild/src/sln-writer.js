import {normalizePath, directoryName} from '@sharpforge/project-system';
import {selectSolutionProjects} from './solution-selection.js';

const folderType = '2150E333-8FDC-42A3-9474-1A3956D46DE8';
const projectTypes = Object.freeze({csproj: 'FAE04EC0-301F-11D3-BF4B-00C04F79EFBC',
  fsproj: 'F2A71F9B-5D33-465A-A702-920D77279786', vbproj: 'F184B08F-C81C-45F6-A57F-5ABD9991F28F',
  vcxproj: '8BC9CEB8-8B4A-11D0-8D11-00A0C91BC942'});

function guid(value) {
  const normalized = String(value).replace(/[{}]/g, '').toUpperCase();
  if (!/^[\dA-F]{8}-[\dA-F]{4}-[\dA-F]{4}-[\dA-F]{4}-[\dA-F]{12}$/.test(normalized)) throw new Error('Invalid solution GUID');
  return '{' + normalized + '}';
}

/** Stable deterministic IDs for newly authored entries; existing GUIDs are always retained. */
export function solutionEntryId(identity) {
  const chunks = [];
  for (let seed = 0; seed < 4; seed++) {
    let hash = (2166136261 + seed * 2654435761) >>> 0;
    for (const character of identity) hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
    chunks.push(hash.toString(16).padStart(8, '0'));
  }
  const text = chunks.join('');
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-5${text.slice(13, 16)}-a${text.slice(17, 20)}-${text.slice(20)}`;
}

function quoted(value) {
  if (typeof value !== 'string' || /[\x00-\x1f"]/.test(value)) throw new Error('Invalid solution quoted value');
  return '"' + value + '"';
}

function relativePath(value, solutionPath) {
  const base = directoryName(normalizePath(solutionPath)).split('/').filter(Boolean);
  const target = normalizePath(value).split('/');
  let offset = 0;
  while (offset < base.length && base[offset] === target[offset]) offset++;
  return [...base.slice(offset).map(() => '..'), ...target.slice(offset)].join('\\');
}

function section(lines, name, scope, entries) {
  lines.push(`\tGlobalSection(${name}) = ${scope}`, ...entries.map(value => '\t\t' + value), '\tEndGlobalSection');
}

/** Serialize a complete classic solution, including explicit build/deploy selections and unloaded project entries. */
export function writeLegacySolution(model, options = {}) {
  const {path = model.path.replace(/\.slnx$/i, '.sln'), newline = '\r\n', bom = false, signal} = options;
  if (!['\n', '\r\n'].includes(newline)) throw new Error('Invalid solution newline');
  if (model.projects.length > 10_000 || model.configurations.length > 4096) throw new Error('Solution model size limit exceeded');
  const lines = ['Microsoft Visual Studio Solution File, Format Version 12.00', '# Visual Studio Version 17',
    'VisualStudioVersion = 17.0.31903.59', 'MinimumVisualStudioVersion = 10.0.40219.1'];
  const ids = new Map();
  const usedIds = new Set();
  const projects = model.projects.map(project => {
    const id = guid(project.id ?? solutionEntryId('project:' + project.path));
    if (usedIds.has(id)) throw new Error('Duplicate solution GUID');
    usedIds.add(id);
    ids.set(project.path, id);
    if (project.id) ids.set(project.id.toLowerCase(), id);
    const extension = project.path.split('.').at(-1).toLowerCase();
    const type = project.type && /^[{\da-f-]{36,38}$/i.test(project.type) ? project.type : projectTypes[extension];
    if (!type) throw new Error('Unknown project type requires an explicit type GUID: ' + project.path);
    return {...project, id, type: guid(type)};
  });
  const folders = (model.folderRecords ?? model.folders ?? []).map(folder => {
    const name = typeof folder === 'string' ? folder : folder.path ?? folder.name;
    const id = guid(folder.id ?? solutionEntryId('folder:' + name));
    if (usedIds.has(id)) throw new Error('Duplicate solution GUID');
    usedIds.add(id);
    ids.set(name, id);
    return {...folder, path: name, id};
  });
  for (const folder of folders) {
    const name = folder.path.split('/').filter(Boolean).at(-1);
    lines.push(`Project("{${folderType}}") = ${quoted(name)}, ${quoted(name)}, "${folder.id}"`);
    const files = (model.files ?? model.items?.filter(item => item.kind === 'file') ?? []).filter(file => file.folder === folder.path);
    if (files.length) {
      lines.push('\tProjectSection(SolutionItems) = preProject');
      for (const file of files) { const relative = relativePath(file.path, path); lines.push(`\t\t${relative} = ${relative}`); }
      lines.push('\tEndProjectSection');
    }
    lines.push('EndProject');
  }
  for (const project of projects) {
    signal?.throwIfAborted();
    const name = project.name ?? project.displayName ?? project.path.split('/').at(-1).replace(/\.[^.]+$/, '');
    lines.push(`Project("${project.type}") = ${quoted(name)}, ${quoted(relativePath(project.path, path))}, "${project.id}"`);
    if (project.dependencies?.length) {
      lines.push('\tProjectSection(ProjectDependencies) = postProject');
      for (const dependency of project.dependencies) {
        const id = ids.get(dependency) ?? ids.get(dependency.toLowerCase());
        if (!id) throw new Error('Solution dependency references an unknown project');
        lines.push(`\t\t${id} = ${id}`);
      }
      lines.push('\tEndProjectSection');
    }
    for (const group of project.sections ?? []) {
      if (group.name === 'ProjectDependencies') continue;
      lines.push(`\tProjectSection(${group.name}) = ${group.scope}`, ...group.lines, '\tEndProjectSection');
    }
    lines.push('EndProject');
  }
  lines.push('Global');
  section(lines, 'SolutionConfigurationPlatforms', 'preSolution', model.configurations.map(value => `${value.name} = ${value.name}`));
  const mappings = [];
  for (const configuration of model.configurations) {
    const selection = selectSolutionProjects(model, {...configuration, action: 'evaluate'});
    for (const project of selection.projects) {
      if (project.configuration === null || project.platform === null) continue;
      const id = ids.get(project.path);
      const mapped = project.configuration + '|' + (project.platform === 'AnyCPU' ? 'Any CPU' : project.platform);
      mappings.push(`${id}.${configuration.name}.ActiveCfg = ${mapped}`);
      if (project.build) mappings.push(`${id}.${configuration.name}.Build.0 = ${mapped}`);
      if (project.deploy) mappings.push(`${id}.${configuration.name}.Deploy.0 = ${mapped}`);
    }
  }
  section(lines, 'ProjectConfigurationPlatforms', 'postSolution', mappings);
  const nested = [...folders, ...projects].flatMap(entry => {
    const parent = entry.folder || (entry.path?.startsWith('/') ? entry.path.replace(/[^/]+\/$/, '') : null);
    const parentId = parent && ids.get(parent);
    return parentId && parentId !== entry.id ? [`${entry.id} = ${parentId}`] : [];
  });
  if (nested.length) section(lines, 'NestedProjects', 'preSolution', nested);
  for (const group of model.globalSections ?? []) {
    if (['SolutionConfigurationPlatforms', 'ProjectConfigurationPlatforms', 'NestedProjects'].includes(group.name)) continue;
    lines.push(`\tGlobalSection(${group.name}) = ${group.scope}`, ...group.lines, '\tEndGlobalSection');
  }
  lines.push('EndGlobal', '');
  return (bom ? '\uFEFF' : '') + lines.join(newline);
}
