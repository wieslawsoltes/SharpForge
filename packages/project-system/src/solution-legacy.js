import { normalizePath, directoryName, baseName } from './paths.js';
import { xmlEscape } from './xml.js';

const folderTypes = new Set(['2150e333-8fdc-42a3-9474-1a3956d46de8', '66a26720-8fb5-11d2-aa7e-00c04f688dde']);

function parseSolutionSections(text, path) {
  if (typeof text !== 'string' || text.length > 4 * 1024 * 1024 ||
    !text.replace(/^\uFEFF/, '').includes('Microsoft Visual Studio Solution File')) throw new Error('Not a supported classic Visual Studio solution');
  const nodes = new Map();
  const nested = new Map();
  const globalSections = [];
  let current = null;
  let section = null;
  for (const line of text.split(/\r?\n/)) {
    const project = /^\s*Project\("\{([\da-f-]+)\}"\)\s*=\s*"([^"]*)",\s*"([^"]*)",\s*"\{([\da-f-]+)\}"\s*$/i.exec(line);
    if (project) {
      if (nodes.size >= 10_000) throw new Error('Solution project limit exceeded');
      if (current) throw new Error('Nested project declaration');
      const id = project[4].toLowerCase();
      if (nodes.has(id)) throw new Error('Duplicate solution project ID');
      current = {id, type: project[1].toLowerCase(), name: project[2], raw: project[3], files: [], dependencies: [], sections: []};
      current.folder = folderTypes.has(current.type);
      if (!current.folder) {
        try { current.path = normalizePath(current.raw, directoryName(path)); }
        catch (error) { throw new Error('Unsafe solution project path: ' + current.raw, {cause: error}); }
      }
      nodes.set(id, current);
      continue;
    }
    if (/^\s*EndProject\s*$/.test(line)) {
      current = null;
      section = null;
      continue;
    }
    const group = /^\s*(Global|Project)Section\(([^)]+)\)\s*=\s*(\w+)/.exec(line);
    if (group) {
      section = {name: group[2], scope: group[3], lines: []};
      if (group[1] === 'Project') {
        if (!current) throw new Error('ProjectSection outside a project');
        current.sections.push(section);
      } else globalSections.push(section);
      continue;
    }
    if (/^\s*End(?:Global|Project)Section/.test(line)) {
      section = null;
      continue;
    }
    if (!section) continue;
    section.lines.push(line);
    if (section.name === 'NestedProjects') {
      const match = /\{([\da-f-]+)\}\s*=\s*\{([\da-f-]+)\}/i.exec(line);
      if (match) nested.set(match[1].toLowerCase(), match[2].toLowerCase());
    } else if (section.name === 'SolutionItems' && current?.folder) {
      const value = line.trim().split(/\s*=\s*/)[0];
      if (value) current.files.push(normalizePath(value, directoryName(path)));
    } else if (section.name === 'ProjectDependencies' && current) {
      const match = /\{([\da-f-]+)\}\s*=\s*\{([\da-f-]+)\}/i.exec(line);
      if (match) current.dependencies.push(match[1].toLowerCase());
    }
  }
  if (current || section) throw new Error('Unterminated solution project or section');
  return { nodes, nested, globalSections };
}

function folderPath(id, nodes, nested) {
  const parts = [];
  const seen = new Set();
  let node = nodes.get(id);
  while (node) {
    if (seen.has(node.id)) throw new Error('Solution folder cycle');
    seen.add(node.id);
    if (node.folder) {
      const name = node.name.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
      if (!name || name.split('/').includes('..')) throw new Error('Invalid solution folder name');
      parts.unshift(name);
    }
    const parent = nested.get(node.id);
    if (parent && !nodes.get(parent)?.folder) throw new Error('Missing or invalid solution folder parent');
    node = nodes.get(parent);
  }
  return parts.length ? '/' + parts.join('/') + '/' : '';
}

/** Bounded classic solution reader. Unsupported project entries remain as unloaded records. */
export function readLegacySolution(text, path) {
  const { nodes, nested, globalSections } = parseSolutionSections(text, path);
  const diagnostics = [];
  const folders = [];
  const folderRecords = [];
  const projects = [];
  const projectPaths = [];
  const items = [];
  for (const node of nodes.values()) {
    const folder = folderPath(node.id, nodes, nested);
    if (node.folder) {
      folders.push(folder);
      folderRecords.push({...node, path: folder, parentId: nested.get(node.id) ?? null});
      for (const file of node.files) items.push({kind: 'file', path: file, folder});
      continue;
    }
    const supported = /\.csproj$/i.test(node.path);
    const reason = supported ? null : 'Project type requires its native toolchain: ' + node.path;
    const record = {...node, folder, parentId: nested.get(node.id) ?? null, supported, unloaded: !supported, reason};
    projects.push(record);
    items.push({kind: 'project', ...record});
    if (supported) projectPaths.push(node.path);
    else diagnostics.push({path: node.path, message: reason, severity: 'warning', code: 'SFP1301'});
  }
  return {path, name: baseName(path).replace(/\.sln$/i, ''), folders: [...new Set(folders)], folderRecords, items,
    projects, projectPaths, legacy: true, diagnostics, globalSections};
}

/** Explicit conversion retains unsupported projects and preserves the original classic file. */
export function convertLegacySolution(text, path, target = path.replace(/\.sln$/i, '.slnx')) {
  const solution = readLegacySolution(text, path);
  const relative = value => {
    const left = directoryName(target).split('/').filter(Boolean);
    const right = value.split('/');
    while (left.length && right.length && left[0] === right[0]) {
      left.shift();
      right.shift();
    }
    return [...left.map(() => '..'), ...right].join('/');
  };
  const itemText = (item, indent) => `${indent}<${item.kind === 'project' ? 'Project' : 'File'} Path="${xmlEscape(relative(item.path))}" />\n`;
  let xml = '<Solution>\n';
  for (const folder of solution.folders) {
    xml += `  <Folder Name="${xmlEscape(folder)}">\n`;
    for (const item of solution.items.filter(value => value.folder === folder)) xml += itemText(item, '    ');
    xml += '  </Folder>\n';
  }
  for (const item of solution.items.filter(value => !value.folder)) xml += itemText(item, '  ');
  return {path: target, text: xml + '</Solution>\n', warnings: [
    'Classic solution configuration mappings are not converted by this structural conversion; the original .sln is retained.',
    ...solution.diagnostics.map(diagnostic => diagnostic.message)
  ]};
}
