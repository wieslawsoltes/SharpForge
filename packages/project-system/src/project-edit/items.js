import {projectTree, elements, localName, attribute, attributeValue, qualifiedName, escapeText, escapeAttribute,
  formatting, indentation, removeNodeEdit, removableGroup, insertChildEdit, createEditPlan, xmlName} from './tree.js';

function literal(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /[\x00-\x1f;$@%*?]/.test(value)) {
    throw new Error('Expected a literal project item identity');
  }
  return value;
}

function metadataMarkup(metadata, tag, layout, prefix = '') {
  const entries = Object.entries(metadata);
  if (entries.length > 256) throw new Error('Metadata count limit exceeded');
  return entries.filter(([, value]) => value !== null).map(([name, value]) => {
    xmlName(name);
    const child = tag.includes(':') ? tag.slice(0, tag.indexOf(':') + 1) + name : name;
    return `${prefix}<${child}>${escapeText(value)}</${child}>`;
  }).join(layout.multiline ? layout.newline : '');
}

function itemMarkup(tag, operation, identity, metadata, layout, indent) {
  const content = metadataMarkup(metadata, tag, layout, layout.multiline ? indent + layout.indent : '');
  const opening = `<${tag} ${operation}="${escapeAttribute(identity)}"`;
  if (!content) return opening + ' />';
  return layout.multiline ? `${opening}>${layout.newline}${content}${layout.newline}${indent}</${tag}>` :
    `${opening}>${content}</${tag}>`;
}

function metadataEdits(source, node, metadata, layout) {
  const edits = [];
  const added = {};
  for (const [name, value] of Object.entries(metadata)) {
    xmlName(name);
    const attr = attribute(node, name);
    const children = elements(node).filter(child => localName(child) === name && !attributeValue(child, 'Condition'));
    if (children.length > 1 || attr && children.length) throw new Error('Ambiguous item metadata: ' + name);
    if (attr) {
      edits.push(value === null ? {start: attr.leadingStart, end: attr.end, text: ''} :
        {start: attr.valueStart, end: attr.valueEnd, text: escapeAttribute(value, attr.quote)});
    } else if (children[0]) {
      const child = children[0];
      if (value === null) edits.push(removeNodeEdit(source, child));
      else if (child.selfClosing) edits.push({start: child.closeStart, end: child.end, text: `>${escapeText(value)}</${child.name}>`});
      else {
        if (child.children.some(value => value.kind !== 'text')) throw Object.assign(new Error('Structured item metadata requires a source edit'),
          {code: 'SFP2103'});
        edits.push({start: child.openEnd, end: child.closeStart, text: escapeText(value)});
      }
    } else if (value !== null) added[name] = value;
  }
  if (Object.keys(added).length) {
    const prefix = layout.multiline ? indentation(source, node) + layout.indent : '';
    const markup = metadataMarkup(added, node.name, layout, prefix).slice(prefix.length);
    edits.push(insertChildEdit(source, node, markup, layout));
  }
  return edits;
}

/** Edit only direct, unconditional items in the selected group; imported/conditioned definitions remain untouched. */
export function editProjectItem(source, options = {}) {
  const {itemType = 'Compile', identity, operation = 'Include', metadata = {}, condition = '', signal} = options;
  literal(identity);
  if (!['Include', 'Remove', 'Update', 'Delete'].includes(operation)) throw new Error('Invalid item edit operation');
  const document = projectTree(source, {signal});
  const root = document.root;
  const tag = qualifiedName(root, itemType);
  const layout = formatting(source, root);
  const groups = elements(root).filter(node => localName(node) === 'ItemGroup' && (attributeValue(node, 'Condition') ?? '') === condition);
  const candidates = groups.flatMap(group => elements(group).filter(node => localName(node) === itemType &&
    !attributeValue(node, 'Condition')).map(node => ({group, node})));
  const matches = candidates.filter(({node}) => ['Include', 'Remove', 'Update'].some(name => attributeValue(node, name) === identity));
  if (operation === 'Delete') {
    const removed = new Set(matches.map(match => match.node));
    const touched = new Set(matches.map(match => match.group));
    const groupRemovals = new Set([...touched].filter(group => group.children.every(node =>
      removed.has(node) || node.kind === 'text' && !node.value.trim())));
    const edits = [...groupRemovals].map(group => removeNodeEdit(source, group));
    edits.push(...matches.filter(match => !groupRemovals.has(match.group)).map(match => removeNodeEdit(source, match.node)));
    return createEditPlan(source, edits, {signal});
  }
  const exact = matches.filter(({node}) => attributeValue(node, operation) === identity);
  if (exact.length > 1) throw Object.assign(new Error('Duplicate literal project items require an explicit source edit'), {code: 'SFP2104'});
  if (exact.length) return createEditPlan(source, metadataEdits(source, exact[0].node, metadata, layout), {signal});
  const group = groups.find(entry => elements(entry).some(node => localName(node) === itemType));
  const indent = group ? indentation(source, group) + layout.indent : layout.indent.repeat(2);
  const markup = itemMarkup(tag, operation, identity, metadata, layout, indent);
  if (group) return createEditPlan(source, [insertChildEdit(source, group, markup, layout)], {signal});
  const groupTag = qualifiedName(root, 'ItemGroup');
  const conditionText = condition ? ` Condition="${escapeAttribute(condition)}"` : '';
  const wrapped = layout.multiline ? `<${groupTag}${conditionText}>${layout.newline}${indent}${markup}` +
    `${layout.newline}${layout.indent}</${groupTag}>` : `<${groupTag}${conditionText}>${markup}</${groupTag}>`;
  return createEditPlan(source, [insertChildEdit(source, root, wrapped, layout)], {signal});
}

/** Exclude literal items directly; glob membership is expressed with one Remove/Update override. */
export function setProjectItemMembership(source, options = {}) {
  const {identity, itemType = 'Compile', include = true, implicit = false, metadata = {}, signal} = options;
  const document = projectTree(source, {signal});
  const candidates = elements(document.root).filter(group => localName(group) === 'ItemGroup' && !attributeValue(group, 'Condition'))
    .flatMap(group => elements(group).filter(node => localName(node) === itemType && !attributeValue(node, 'Condition')));
  const included = candidates.some(node => attributeValue(node, 'Include') === identity);
  const removed = candidates.some(node => attributeValue(node, 'Remove') === identity);
  let next = source;
  if (include) {
    if (removed) next = editProjectItem(next, {itemType, identity, operation: 'Delete', signal}).text;
    if (implicit) {
      return Object.keys(metadata).length ? editProjectItem(next, {itemType, identity, operation: 'Update', metadata, signal}).text : next;
    }
    return editProjectItem(next, {itemType, identity, metadata, signal}).text;
  }
  if (included) next = editProjectItem(next, {itemType, identity, operation: 'Delete', signal}).text;
  return implicit ? editProjectItem(next, {itemType, identity, operation: 'Remove', signal}).text : next;
}
