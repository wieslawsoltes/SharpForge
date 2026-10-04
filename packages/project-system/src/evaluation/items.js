import { getCaseInsensitive, setCaseInsensitive, splitList, unescape, toBoolean, fail } from './errors.js';
import { scanReference, referenceStart } from './expression-scanner.js';
import { evaluateItemExpression } from './item-expressions.js';
import { getItemMetadata } from './item-metadata.js';
import { evaluateCentralPackages } from './central-packages.js';

const operations = new Set(['Include', 'Exclude', 'Update', 'Remove', 'Condition', 'KeepMetadata', 'RemoveMetadata',
  'KeepDuplicates', 'MatchOnMetadata', 'MatchOnMetadataOptions', 'Label']);
const logicalItemTypes = new Set(['using']);

function specificationPath(context, type, value) {
  return logicalItemTypes.has(type.toLowerCase()) ? value : context.resolvePath(value);
}

export function itemList(context, type) {
  const name = Object.keys(context.items).find(name => name.toLowerCase() === type.toLowerCase()) ?? type;
  return context.items[name] ??= [];
}

function recursiveDirectory(pattern, identity) {
  const at = pattern.indexOf('**');
  if (at < 0) return '';
  const prefix = pattern.slice(0, at);
  const suffix = pattern.slice(at + 2).replace(/^\//, '');
  const end = suffix.includes('/') ? identity.lastIndexOf('/' + suffix.split('/')[0]) : identity.lastIndexOf('/');
  return end >= prefix.length ? identity.slice(prefix.length, end + 1) : '';
}

function itemCopies(value, context) {
  const trimmed = value.trim();
  if (!referenceStart(trimmed, 0) || trimmed[0] !== '@') return null;
  const reference = scanReference(trimmed, 0);
  if (reference.end !== trimmed.length) return null;
  const result = evaluateItemExpression(reference.body, context, { preserveItems: true });
  return Array.isArray(result) ? result : null;
}

function specifications(value, context) {
  return context.expand(value, { decode: false }).split(';').map(value => value.trim()).filter(Boolean)
    .map(raw => ({ value: unescape(raw).replaceAll('\\', '/'), glob: /[*?]/.test(raw) }));
}

function includes(node, context) {
  const type = node.name;
  const value = node.attributes.Include;
  const logical = logicalItemTypes.has(type.toLowerCase());
  const resolve = identity => specificationPath(context, type, identity);
  const exclusions = specifications(node.attributes.Exclude ?? '', context).map(item => resolve(item.value));
  const copies = itemCopies(value, context);
  if (copies) return copies.filter(item => !exclusions.some(pattern => context.pathIndex.matcher(pattern).test(resolve(item.identity))))
    .map(item => ({ ...item, itemType: type, sourceItemType: item.itemType, path: logical ? undefined : resolve(item.identity),
      metadata: { ...item.metadata }, implicit: false }));
  const result = [];
  for (const spec of specifications(value, context)) {
    const pattern = resolve(spec.value);
    const paths = spec.glob ? context.pathIndex.glob(pattern, exclusions) : [pattern];
    for (const path of paths) {
      context.step();
      if (exclusions.some(pattern => context.pathIndex.matcher(pattern).test(path))) continue;
      const prefix = context.base ? context.base + '/' : '';
      const identity = spec.glob ? spec.value.startsWith('/') ? '/' + path
        : prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path : spec.value;
      result.push({ itemType: type, identity, path: logical ? undefined : path, metadata: {}, definingProject: context.currentFile,
        recursiveDir: spec.glob ? recursiveDirectory(spec.value, identity) : '', implicit: false });
      if (result.length > context.limits.items) fail('Item expansion limit exceeded.', 'MSB0001');
    }
  }
  return result;
}

function filterMetadata(item, attributes, context) {
  const keep = attributes.KeepMetadata === undefined ? null : new Set(splitList(context.expand(attributes.KeepMetadata)).map(value => value.toLowerCase()));
  const remove = new Set(splitList(context.expand(attributes.RemoveMetadata)).map(value => value.toLowerCase()));
  if (keep && remove.size) fail('KeepMetadata and RemoveMetadata cannot be used together.', 'MSB4066');
  for (const name of Object.keys(item.metadata)) {
    if (keep && !keep.has(name.toLowerCase()) || remove.has(name.toLowerCase())) delete item.metadata[name];
  }
}

export function evaluateItemMetadata(context, item, node) {
  context.withItem(item, () => {
    for (const [name, value] of Object.entries(node.attributes)) {
      if (!operations.has(name)) setCaseInsensitive(item.metadata, name, context.expand(value));
    }
    for (const metadata of node.children) {
      if (context.enabled(metadata)) setCaseInsensitive(item.metadata, metadata.name, context.expand(metadata.text.trim()));
    }
  });
}

function equalItem(first, second) {
  if (first.identity.toLowerCase() !== second.identity.toLowerCase()) return false;
  const firstKeys = Object.keys(first.metadata);
  const secondKeys = Object.keys(second.metadata);
  return firstKeys.length === secondKeys.length && firstKeys.every(key => first.metadata[key] === getCaseInsensitive(second.metadata, key));
}

function includeItems(context, node, list) {
  const definitions = getCaseInsensitive(context.definitions, node.name) ?? {};
  const keepDuplicates = toBoolean(context.expand(node.attributes.KeepDuplicates ?? 'true'), true);
  for (const item of includes(node, context)) {
    context.step();
    item.metadata = { ...definitions, ...item.metadata };
    filterMetadata(item, node.attributes, context);
    if (!context.withItem(item, () => context.enabled(node))) continue;
    evaluateItemMetadata(context, item, node);
    if (!keepDuplicates && list.some(existing => equalItem(existing, item))) continue;
    if (node.name.toLowerCase() === 'compile' && list.some(existing => existing.path === item.path)) {
      context.diagnostic(`Duplicate Compile item '${item.path}'.`, node, 'SFP1022');
    }
    list.push(item);
    if (list.length > context.limits.items) fail('Item list limit exceeded.', 'MSB0001');
  }
}

function matcher(specs, context, type) {
  const patterns = specs.map(spec => ({ spec, path: specificationPath(context, type, spec.value) }));
  return item => patterns.some(({ spec, path }) => {
    const itemPath = item.path ?? specificationPath(context, type, item.identity);
    return spec.glob ? context.pathIndex.matcher(path, { caseSensitive: false }).test(itemPath)
      : path.toLowerCase() === itemPath.toLowerCase();
  });
}

function metadataMatcher(context, node, copies) {
  const names = splitList(context.expand(node.attributes.MatchOnMetadata));
  const mode = context.expand(node.attributes.MatchOnMetadataOptions ?? 'CaseSensitive');
  if (!['CaseSensitive', 'CaseInsensitive', 'PathLike'].includes(mode)) fail('Invalid MatchOnMetadataOptions.', 'MSB4066');
  const key = item => JSON.stringify(names.map(name => {
    let value = getItemMetadata(item, name, context);
    if (mode === 'PathLike') value = context.resolvePath(value);
    if (mode === 'CaseInsensitive' || mode === 'PathLike' && !context.pathIndex.caseSensitive) value = value.toLowerCase();
    return value;
  }));
  const values = new Set(copies.map(key));
  return item => values.has(key(item));
}

/** Evaluate one ordered Include, Update or Remove operation for any item type. */
export function evaluateItemNode(context, node) {
  const operation = ['Include', 'Update', 'Remove'].filter(name => node.attributes[name] !== undefined);
  if (operation.length !== 1) fail(`Item '${node.name}' requires exactly one Include, Update or Remove operation.`, 'MSB4232');
  const list = itemList(context, node.name);
  if (operation[0] === 'Include') return includeItems(context, node, list);
  let matches = matcher(specifications(node.attributes[operation[0]], context), context, node.name);
  if (node.attributes.MatchOnMetadata) {
    if (operation[0] !== 'Remove') fail('MatchOnMetadata requires a Remove operation.', 'MSB4066');
    const copies = itemCopies(node.attributes.Remove, context);
    if (!copies) fail('MatchOnMetadata requires an item-list reference.', 'MSB4256');
    matches = metadataMatcher(context, node, copies);
  }
  for (let index = 0; index < list.length; index++) {
    const item = list[index];
    context.step();
    if (!matches(item) || !context.withItem(item, () => context.enabled(node))) continue;
    if (operation[0] === 'Remove') { list.splice(index--, 1); continue; }
    evaluateItemMetadata(context, item, node);
    filterMetadata(item, node.attributes, context);
  }
}

export function evaluateItemGroup(context, group, conditionEvaluated = false) {
  if (!conditionEvaluated && !context.enabled(group)) return;
  for (const node of group.children) {
    try { evaluateItemNode(context, node); }
    catch (error) { context.diagnostic(error, node); }
  }
}

export function evaluateItems(context) {
  for (const model of context.sdkModels) {
    for (const item of model.items?.(context) ?? []) {
      const list = itemList(context, item.itemType);
      if (!list.some(existing => item.path === undefined ? equalItem(existing, item) : existing.path === item.path)) list.push(item);
    }
  }
  for (const { node, file } of context.itemGroups) context.withFile(file, () => evaluateItemGroup(context, node));
  if (toBoolean(context.properties.managepackageversionscentrally)) {
    evaluateCentralPackages(context, { versions: itemList(context, 'PackageVersion'),
      references: itemList(context, 'PackageReference'), globals: itemList(context, 'GlobalPackageReference') });
  }
}
