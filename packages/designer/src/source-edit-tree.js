import {CONTROLS} from '@sharpforge/framework';
import {childSlot} from './model.js';
import {propertyStatement} from './source-edit-properties.js';
import {sameSourceValue, removeSourceInitializer, removeSourceStatement, sourceInsertion, sourceConstructionBoundary} from './source-text.js';
import {failSource} from './source-errors.js';
import {sourceCollectionStatements} from './source-edit-collections.js';

function parentMap(document) {
  return new Map(document.nodes.flatMap(parent => parent.children.map((id, index) => [id, {parent, index}])));
}

function edgeStatement(parent, child, names) {
  const slot = childSlot(parent.type);
  if (!slot) failSource('Target control has no editable child slot', null, 'SFSYNC_OWNERSHIP');
  return `${names.get(parent.id)}.${slot.property}${slot.many ? `.Add(${names.get(child)})` : ` = ${names.get(child)}`};`;
}

function referencedOutside(base, binding, allowed) {
  const covers = reference => allowed.some(span => (span.uri ?? base.uri) === reference.uri
    && span.start <= reference.start && span.end >= reference.end);
  return binding.references.filter(reference => !reference.declaration && !covers(reference));
}

function deleteNode(base, binding, edits, external) {
  if (binding.inline) {
    const owner = Object.values(base.bindings).find(candidate => candidate.edges.some(edge => edge.child === binding.id));
    const edge = owner?.edges.find(candidate => candidate.child === binding.id);
    if (!edge) failSource('Inline construction has no owned parent edge', binding.creation, 'SFSYNC_OWNERSHIP');
    if (edge.collection) edits.push(removeSourceInitializer(base, {initializer: {start: binding.creation.start, expression: binding.creation}}));
    else if (edge.initializer) edits.push(removeSourceInitializer(base, edge));
    else edits.push(removeSourceStatement(base, edge.statement));
    return;
  }
  if (binding.statement.kind === 'Local' && binding.statement.declarations.length > 1) {
    failSource('Split this multi-variable declaration before deleting a control', binding.statement, 'SFSYNC_OWNERSHIP');
  }
  const statements = [binding.statement];
  for (const property of Object.values(binding.properties)) {
    if (property.dynamic) failSource('Control owns a protected dynamic expression', property.expression, 'SFSYNC_OWNERSHIP');
    for (const entry of [...(property.previous ?? []), property]) statements.push(entry.statement);
  }
  for (const entries of Object.values(binding.tracks)) for (const entry of entries) statements.push(entry.statement);
  for (const collection of Object.values(binding.collections ?? {})) {
    if (collection.dynamic) failSource('Control owns a protected collection', binding.creation, 'SFSYNC_OWNERSHIP');
    for (const entry of collection.entries) statements.push(...entry.dependencies, entry.statement);
  }
  for (const event of Object.values(binding.events)) {
    if (event.dynamic) failSource('Control owns protected event subscriptions', event.expression, 'SFSYNC_EVENT');
    for (const subscription of event.subscriptions) statements.push(subscription.statement);
  }
  for (const owner of Object.values(base.bindings)) {
    for (const edge of owner.edges) if (edge.child === binding.id || owner.id === binding.id) statements.push(edge.statement);
  }
  const unique = [...new Map(statements.map(statement => [statement.uri + ':' + statement.start, statement])).values()];
  const adaptive = base.responsiveSource;
  const allowed = adaptive ? [...unique, adaptive.method, adaptive.initializer] : unique;
  const references = referencedOutside(base, binding, allowed);
  if (references.length) failSource('Control is referenced by handwritten C# and cannot be deleted', binding.creation,
    'SFSYNC_REFERENCE', {references});
  for (const statement of unique) edits.push(removeSourceStatement(base, statement));
  if (binding.fieldDeclaration) {
    const field = binding.fieldDeclaration;
    const siblings = base.context.partials.flatMap(partial => partial.members)
      .filter(member => member.kind === 'Field' && member.uri === field.uri && member.start === field.start);
    if (siblings.length > 1) failSource('Split this shared field declaration before deleting a control', field, 'SFSYNC_OWNERSHIP');
    external.push({uri: field.uri, start: field.start, end: field.end, text: '', deletion: true});
  }
}

/** Keeps a longest ordered subsequence of existing child edges in O(n log n). */
function retainedChildren(before, after) {
  const positions = new Map(before.map((id, index) => [id, index]));
  const sequence = after.filter(id => positions.has(id));
  const tails = [];
  const links = [];
  for (let index = 0; index < sequence.length; index++) {
    let low = 0;
    let high = tails.length;
    const value = positions.get(sequence[index]);
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (positions.get(sequence[tails[middle]]) < value) low = middle + 1;
      else high = middle;
    }
    links[index] = low ? tails[low - 1] : -1;
    tails[low] = index;
  }
  const kept = new Set();
  for (let index = tails.at(-1) ?? -1; index >= 0; index = links[index]) kept.add(sequence[index]);
  return kept;
}

export function sourceTreeEdits(base, next, names, edits, external) {
  const before = new Map(base.document.nodes.map(node => [node.id, node]));
  const after = new Map(next.nodes.map(node => [node.id, node]));
  const oldParents = parentMap(base.document);
  const newParents = parentMap(next);
  const inserted = next.nodes.filter(node => !before.has(node.id));
  const removed = new Set(base.document.nodes.filter(node => !after.has(node.id)).map(node => node.id));
  for (const id of removed) deleteNode(base, base.bindings[id], edits, external);
  const end = sourceConstructionBoundary(base);
  const groups = new Map();
  for (const parent of next.nodes) {
    const old = before.get(parent.id);
    if (sameSourceValue(old?.children ?? [], parent.children)) continue;
    const kept = retainedChildren(old?.children ?? [], parent.children);
    const edges = new Map((base.bindings[parent.id]?.edges ?? []).map(edge => [edge.child, edge]));
    for (const edge of edges.values()) {
      if (kept.has(edge.child) || removed.has(edge.child)) continue;
      if (edge.collection || edge.initializer || base.bindings[edge.child]?.inline) {
        failSource('Moving inline children requires an explicit initializer edit in Code view', edge.expression, 'SFSYNC_OWNERSHIP');
      }
      edits.push(removeSourceStatement(base, edge.statement));
    }
    const followingKept = new Array(parent.children.length);
    let following = null;
    for (let index = parent.children.length - 1; index >= 0; index--) {
      followingKept[index] = following;
      if (kept.has(parent.children[index])) following = parent.children[index];
    }
    for (let index = 0; index < parent.children.length; index++) {
      const child = parent.children[index];
      if (kept.has(child)) continue;
      if (base.bindings[parent.id]?.inline) failSource('Structural insertion requires a named container',
        base.bindings[parent.id].creation, 'SFSYNC_OWNERSHIP');
      if (before.has(child) && oldParents.get(child)?.parent.id !== newParents.get(child)?.parent.id) {
        clearAttachedProperties(base, after.get(child), parent, edits);
      }
      const edge = edges.get(followingKept[index]);
      if (edge?.initializer || edge?.collection) failSource('Collection ordering is protected', edge.expression, 'SFSYNC_OWNERSHIP');
      const at = edge?.statement.start ?? end;
      if (!groups.has(at)) groups.set(at, []);
      groups.get(at).push(edgeStatement(parent, child, names));
    }
  }
  const declarations = [];
  const takenNames = new Set([...base.context.symbols.map(symbol => symbol.name), ...names.values()]);
  for (const node of inserted) insertNode(base, node, names, declarations, {external, takenNames, design: next});
  edits.push(sourceInsertion(base, declarations, Math.min(end, ...groups.keys())));
  for (const [at, statements] of groups) edits.push(sourceInsertion(base, statements, at));
}

function insertNode(base, node, names, statements, {external, takenNames, design}) {
  const name = names.get(node.id);
  const type = node.projectType ?? node.type;
  const useFields = Object.values(base.bindings).some(binding => binding.field);
  if (useFields && base.owner) {
    const modifier = base.method.modifiers?.includes('static') ? 'static ' : '';
    const line = base.text.lastIndexOf('\n', base.method.start - 1) + 1;
    const ownLine = /^[ \t]*$/.test(base.text.slice(line, base.method.start));
    const at = ownLine ? line : base.method.start;
    const prefix = ownLine ? '' : base.style.newline;
    const suffix = ownLine ? '' : base.style.methodIndent;
    const text = `${prefix}${base.style.methodIndent}private ${modifier}${type} ${name};${base.style.newline}${suffix}`;
    external.push({uri: base.uri, start: at, end: at, text});
    statements.push(`${name} = new ${type}();`);
  } else {
    const declaredType = base.style.usesVar ? 'var' : type;
    statements.push(`${declaredType} ${name} = new ${type}();`);
  }
  for (const key of Object.keys(node.properties)) statements.push(propertyStatement(node, key, name));
  for (const [event, handler] of Object.entries(node.events)) statements.push(`${name}.${event} += ${handler};`);
  statements.push(...sourceCollectionStatements({design, node, variable: name, takenNames}));
}

function clearAttachedProperties(base, node, parent, edits) {
  const old = base.bindings[node.id];
  for (const key of ['Left', 'Top', 'Row', 'Column', 'RowSpan', 'ColumnSpan', 'WrapRowSpan', 'WrapColumnSpan']) {
    const owner = key.startsWith('Wrap') ? 'VariableSizedWrapGrid' : ['Left', 'Top', 'ZIndex'].includes(key) ? 'Canvas' : 'Grid';
    if (parent?.type === CONTROLS + owner) continue;
    const property = old.properties[key];
    if (property?.dynamic) failSource('Moving the control would remove a protected attached property', property.expression, 'SFSYNC_DYNAMIC');
    if (property) edits.push(property.initializer ? removeSourceInitializer(base, property) : removeSourceStatement(base, property.statement));
    delete node.properties[key];
  }
}
