import {parseXml, normalizePath, directoryName, xmlEscape} from '@sharpforge/project-system';
import {readSlnxConfigurations} from './solution-configurations.js';

function record(node) {
  return {
    element: node.name,
    attributes: {...node.attributes},
    ...(node.text.trim() ? {text: node.text.trim()} : {}),
    ...(node.children.length ? {children: node.children.map(record)} : {})
  };
}

function inspectChildren(node, folder, base, result) {
  for (const child of node.children) {
    if (child.name === 'Folder') {
      const name = child.attributes.Name ?? '';
      const next = name.startsWith('/') ? name : (folder + '/' + name).replace(/\/+/g, '/');
      result.folders.push({name: next, attributes: {...child.attributes}});
      inspectChildren(child, next, base, result);
    } else if (child.name === 'Project') {
      result.projects.push({path: normalizePath(child.attributes.Path ?? '', base), folder,
        attributes: {...child.attributes}, rules: child.children.map(record)});
    } else if (child.name === 'File') {
      result.files.push({path: normalizePath(child.attributes.Path ?? '', base), folder});
    } else if (child.name === 'Configurations') {
      result.configurations.push(record(child));
    } else {
      result.other.push(record(child));
    }
  }
}

/** Inspect retained XML structure and configuration mappings; never evaluate a project or execute a target. */
export function inspectSlnx(text, {path = 'Workspace.slnx'} = {}) {
  const root = parseXml(text, {maxLength: 4 * 1024 * 1024, maxNodes: 50_000});
  if (root.name !== 'Solution') throw new Error('Expected <Solution> root');
  const result = {path, attributes: {...root.attributes}, configurations: [], projects: [], folders: [], files: [], other: []};
  inspectChildren(root, '', directoryName(normalizePath(path)), result);
  return {...result, configurationModel: readSlnxConfigurations(text, {path}),
    semantics: 'Configuration rules and project defaults are available in configurationModel; native build execution remains explicit.'};
}

/** Create a .slnx at a workspace path, referencing normalized project paths relative to that solution. */
export function createWorkspaceSlnx(path, projects) {
  const parent = directoryName(normalizePath(path)).split('/').filter(Boolean);
  const entries = projects.map(project => {
    const parts = normalizePath(project).split('/');
    let offset = 0;
    while (offset < parent.length && parent[offset] === parts[offset]) offset++;
    const relative = [...parent.slice(offset).map(() => '..'), ...parts.slice(offset)].join('/');
    return `  <Project Path="${xmlEscape(relative)}" />`;
  });
  return '<Solution>\n' + entries.join('\n') + '\n</Solution>\n';
}
