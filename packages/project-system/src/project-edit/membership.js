import {normalizePath, directoryName} from '../paths.js';
import {projectTree, elements, localName, attributeValue} from './tree.js';
import {editProjectItem, setProjectItemMembership} from './items.js';

function relativeTo(path, base) {
  const left = base.split('/').filter(Boolean);
  const right = path.split('/');
  let at = 0;
  while (at < left.length && left[at] === right[at]) at++;
  return [...left.slice(at).map(() => '..'), ...right.slice(at)].join('/');
}

function validPath(path) {
  if (typeof path !== 'string' || /[\x00-\x1f<>:"|?*$@%;]/.test(path) || path.replaceAll('\\', '/').split('/').includes('..')) {
    throw new Error('Expected a safe literal workspace path');
  }
  return normalizePath(path);
}

/** Explorer-compatible membership editing with bounded literal overrides and no changes to imported/conditional XML. */
export function sourcePreservingProjectMembership(source, options) {
  const {projectPath, path, include = true, itemType = 'Compile', metadata = {}} = options;
  const identity = relativeTo(validPath(path), directoryName(validPath(projectPath)));
  const root = projectTree(source).root;
  const unconditional = elements(root).filter(group => !attributeValue(group, 'Condition'));
  const properties = unconditional.filter(group => localName(group) === 'PropertyGroup').flatMap(elements);
  const disabled = properties.some(property => localName(property) === 'EnableDefaultCompileItems' &&
    property.children.some(child => child.kind === 'text' && child.value.trim().toLowerCase() === 'false'));
  const sdk = attributeValue(root, 'Sdk') || elements(root).some(node => localName(node) === 'Sdk');
  const items = unconditional.filter(group => localName(group) === 'ItemGroup').flatMap(elements);
  const implicit = itemType === 'Compile' && !!sdk && !disabled || items.some(node => localName(node) === itemType &&
    !attributeValue(node, 'Condition') && /[*?]/.test(attributeValue(node, 'Include') ?? ''));
  const existing = items.some(node => localName(node) === itemType && ['Include', 'Remove', 'Update']
    .some(name => attributeValue(node, name) === identity));
  const imported = elements(root).some(node => ['Import', 'ImportGroup'].includes(localName(node)));
  // Explicit imports can redefine membership; retain the ordered override when their contents are unknown.
  if (include && implicit && (!existing || imported)) {
    const clean = existing ? editProjectItem(source, {itemType, identity, operation: 'Delete'}).text : source;
    const excluded = editProjectItem(clean, {itemType, identity, operation: 'Remove'}).text;
    return editProjectItem(excluded, {itemType, identity, metadata}).text;
  }
  return setProjectItemMembership(source, {...options, identity, implicit});
}

/** Named package/assembly identities are never interpreted as file paths or MSBuild expressions. */
export function sourcePreservingNamedProjectItem(source, options = {}) {
  const {itemType = 'PackageReference', name, include = true, metadata = {}} = options;
  if (!['PackageReference', 'Reference', 'Analyzer'].includes(itemType)) throw new Error('Invalid literal project item type');
  return editProjectItem(source, {itemType, identity: name, operation: include ? 'Include' : 'Delete', metadata}).text;
}
