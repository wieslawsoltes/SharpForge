import {normalizePath, directoryName} from '../paths.js';
import {parseXml, xmlEscape} from '../xml.js';
import {sourcePreservingProjectMembership, sourcePreservingNamedProjectItem} from '../project-edit/index.js';

export function relativeTo(path, base) {
  const source = base.split('/').filter(Boolean);
  const target = path.split('/');
  while (source.length && target.length && source[0] === target[0]) { source.shift(); target.shift(); }
  return [...source.map(() => '..'), ...target].join('/');
}

export function validateItemPath(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024 || /[\u0000-\u001f<>:"|?*]/.test(value) ||
      /^(?:[\\/]|[A-Za-z]:)/.test(value)) throw new Error('Enter a relative file or folder path without reserved characters');
  if (value.replaceAll('\\', '/').split('/').some(part => part === '..')) throw new Error('Parent path components are not accepted for file changes');
  const path = normalizePath(value.trim());
  if (path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || ['.git', '.sharpforge', 'node_modules'].includes(part))) {
    throw new Error('This path is reserved or not portable');
  }
  return path;
}

/** Exact element spans preserve comments, declarations, quoted delimiters and a BOM. */
function elementSpan(text, node) {
  const start = node.start + (text.startsWith('\uFEFF') ? 1 : 0);
  const token = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:"[^"]*"|'[^']*'|[^'">])*?>/g;
  token.lastIndex = start;
  let depth = 0;
  let match;
  let openEnd;
  while ((match = token.exec(text))) {
    const value = match[0];
    if (/^<(?:!|\?)/.test(value)) continue;
    openEnd ??= token.lastIndex;
    if (value.startsWith('</')) depth--;
    else if (!/\/\s*>$/.test(value)) depth++;
    if (depth === 0) return {start, openEnd, closeStart: match.index, end: token.lastIndex, selfClosing: match.index === start};
  }
  throw new Error('Unterminated XML element');
}

function appendToElement(text, node, fragment) {
  const span = elementSpan(text, node);
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const insert = fragment.replaceAll('\n', newline) + newline;
  if (span.selfClosing) {
    const opening = text.slice(span.start, span.end);
    const slash = opening.lastIndexOf('/');
    return text.slice(0, span.start) + opening.slice(0, slash) + '>' + newline + insert + '</' + node.name + '>' + text.slice(span.end);
  }
  return text.slice(0, span.closeStart) + insert + text.slice(span.closeStart);
}

export const editProjectMembership = (text, options) => sourcePreservingProjectMembership(text, options);
export const editNamedProjectItem = (text, options) => sourcePreservingNamedProjectItem(text, options);

function solutionFolderName(name) {
  return '/' + validateItemPath(String(name).trim().replace(/^\/+|\/+$/g, '')) + '/';
}

function findFolder(root, name) {
  if (root.name === 'Folder' && root.attributes.Name && solutionFolderName(root.attributes.Name) === name) return root;
  for (const child of root.children) {
    const found = findFolder(child, name);
    if (found) return found;
  }
  return null;
}

function visitElements(node, action) { action(node); node.children.forEach(child => visitElements(child, action)); }

function applyEdits(text, edits) {
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  }
  parseXml(text);
  return text;
}

export function addSolutionProject(text, {solutionPath, projectPath, folder = null}) {
  projectPath = validateItemPath(projectPath);
  solutionPath = validateItemPath(solutionPath);
  const path = relativeTo(projectPath, directoryName(solutionPath));
  const root = parseXml(text);
  if (root.name !== 'Solution') throw new Error('Expected <Solution>');
  visitElements(root, node => {
    if (node.name === 'Project' && node.attributes.Path && normalizePath(node.attributes.Path, directoryName(solutionPath)) === projectPath) {
      throw new Error('Project already belongs to this solution');
    }
  });
  const entry = '  <Project Path="' + xmlEscape(path) + '" />';
  if (!folder) return appendToElement(text, root, entry);
  const name = solutionFolderName(folder);
  const existing = findFolder(root, name);
  if (existing) return appendToElement(text, existing, '  ' + entry);
  return appendToElement(text, root, '  <Folder Name="' + xmlEscape(name) + '">\n  ' + entry + '\n  </Folder>');
}

export function addSolutionFolder(text, name) {
  name = solutionFolderName(name);
  const root = parseXml(text);
  if (root.name !== 'Solution') throw new Error('Expected <Solution>');
  if (findFolder(root, name)) throw new Error('Solution folder already exists');
  return appendToElement(text, root, '  <Folder Name="' + xmlEscape(name) + '" />');
}

const pathAttributes = new Set(['Include', 'Update', 'Remove', 'Path', 'Project']);
const nonPathItems = new Set(['PackageReference', 'PackageVersion', 'FrameworkReference', 'Reference', 'Using']);

/** Decode XML entities before comparing literal paths and preserve quote style when escaping the replacement. */
export function rewriteProjectPath(text, {documentPath, oldPath, newPath, newDocumentPath = documentPath}) {
  return rewriteProjectPaths(text, {documentPath, mappings: [{from: oldPath, to: newPath}], newDocumentPath});
}

/** Rebase every original literal once while applying a complete batch, avoiding cascading relative-path rewrites. */
export function rewriteProjectPaths(text, {documentPath, mappings, newDocumentPath = documentPath}) {
  const root = parseXml(text);
  const base = directoryName(documentPath);
  const destinationBase = directoryName(newDocumentPath);
  const edits = [];
  visitElements(root, node => {
    const span = elementSpan(text, node);
    const original = text.slice(span.start, span.openEnd);
    const rewritten = original.replace(/(\s+)([A-Za-z_][\w.:-]*)(\s*=\s*)(["'])([\s\S]*?)\4/g,
      (all, space, key, equals, quote) => {
        const decoded = node.attributes[key];
        if (!pathAttributes.has(key) || typeof decoded !== 'string' || /[$@%*?]/.test(decoded) ||
            nonPathItems.has(node.name) && ['Include', 'Update', 'Remove'].includes(key)) return all;
        let changed = false;
        const parts = decoded.split(';').map(part => {
          if (!part.trim()) return part;
          const resolved = normalizePath(part, base);
          const mapping = mappings.find(item => resolved === item.from || resolved.startsWith(item.from + '/'));
          if (!mapping && destinationBase === base) return part;
          changed = true;
          return relativeTo(mapping ? mapping.to + resolved.slice(mapping.from.length) : resolved, destinationBase);
        });
        const escaped = xmlEscape(parts.join(';')).replaceAll("'", '&apos;');
        return changed ? space + key + equals + quote + escaped + quote : all;
      });
    if (rewritten !== original) edits.push({start: span.start, end: span.openEnd, text: rewritten});
  });
  return applyEdits(text, edits);
}

export function removeSolutionProject(text, {solutionPath, projectPath}) {
  const root = parseXml(text);
  if (root.name !== 'Solution') throw new Error('Expected <Solution>');
  const edits = [];
  const visit = node => {
    const path = node.name === 'Project' ? node.attributes.Path : node.name === 'BuildDependency' ? node.attributes.Project : null;
    if (path && normalizePath(path, directoryName(solutionPath)) === projectPath) {
      edits.push({...elementSpan(text, node), text: ''});
      return;
    }
    node.children.forEach(visit);
  };
  visit(root);
  if (!edits.length) throw new Error('Project does not belong to this solution');
  return applyEdits(text, edits);
}

export function renameSolutionFolder(text, {folder, name}) {
  const previous = solutionFolderName(folder);
  const next = solutionFolderName(name);
  const root = parseXml(text);
  if (root.name !== 'Solution' || !findFolder(root, previous)) throw new Error('Solution folder not found');
  if (next.startsWith(previous) && next !== previous) throw new Error('A solution folder cannot be moved into itself');
  if (next !== previous && findFolder(root, next)) throw new Error('Destination solution folder already exists');
  const edits = [];
  visitElements(root, node => {
    if (node.name !== 'Folder' || !node.attributes.Name) return;
    const current = solutionFolderName(node.attributes.Name);
    if (current !== previous && !current.startsWith(previous)) return;
    const span = elementSpan(text, node);
    const original = text.slice(span.start, span.openEnd);
    const rewritten = original.replace(/(\bName\s*=\s*)(["'])([\s\S]*?)\2/,
      (_, prefix, quote) => prefix + quote + xmlEscape(next + current.slice(previous.length)).replaceAll("'", '&apos;') + quote);
    edits.push({start: span.start, end: span.openEnd, text: rewritten});
  });
  return applyEdits(text, edits);
}

export function removeSolutionFolder(text, folder) {
  const name = solutionFolderName(folder);
  const root = parseXml(text);
  if (root.name !== 'Solution') throw new Error('Expected <Solution>');
  const edits = [];
  const visit = node => {
    if (node.name === 'Folder' && node.attributes.Name) {
      const current = solutionFolderName(node.attributes.Name);
      if (current === name || current.startsWith(name)) { edits.push({...elementSpan(text, node), text: ''}); return; }
    }
    node.children.forEach(visit);
  };
  visit(root);
  if (!edits.length) throw new Error('Solution folder not found');
  return applyEdits(text, edits);
}

export function moveSolutionProject(text, {solutionPath, projectPath, folder = null}) {
  const root = parseXml(text);
  if (root.name !== 'Solution') throw new Error('Expected <Solution>');
  let found;
  visitElements(root, node => {
    if (node.name === 'Project' && node.attributes.Path &&
        normalizePath(node.attributes.Path, directoryName(solutionPath)) === projectPath) found = node;
  });
  if (!found) throw new Error('Project not found in solution');
  const span = elementSpan(text, found);
  const fragment = text.slice(span.start, span.end);
  text = text.slice(0, span.start) + text.slice(span.end);
  if (!folder) return appendToElement(text, parseXml(text), '  ' + fragment);
  const name = solutionFolderName(folder);
  if (!findFolder(parseXml(text), name)) text = addSolutionFolder(text, name);
  return appendToElement(text, findFolder(parseXml(text), name), '    ' + fragment);
}

export function addSolutionItem(text, {solutionPath, path, folder = 'Solution Items'}) {
  const root = parseXml(text);
  if (root.name !== 'Solution') throw new Error('Expected <Solution>');
  path = validateItemPath(path);
  visitElements(root, node => {
    if (node.name === 'File' && node.attributes.Path && normalizePath(node.attributes.Path, directoryName(solutionPath)) === path) {
      throw new Error('Solution item already exists');
    }
  });
  const name = solutionFolderName(folder);
  if (!findFolder(root, name)) text = addSolutionFolder(text, name);
  return appendToElement(text, findFolder(parseXml(text), name),
    '    <File Path="' + xmlEscape(relativeTo(path, directoryName(solutionPath))) + '" />');
}
