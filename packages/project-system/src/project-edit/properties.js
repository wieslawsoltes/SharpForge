import {projectTree, elements, localName, attributeValue, qualifiedName, escapeText, formatting,
  removeNodeEdit, removableGroup, insertChildEdit, createEditPlan} from './tree.js';

/** Set or remove one literal property in a matching direct PropertyGroup; null removes it. */
export function editProjectProperty(source, options = {}) {
  const {name, value, condition = '', propertyCondition = '', signal} = options;
  const document = projectTree(source, {signal});
  const root = document.root;
  const tag = qualifiedName(root, name);
  const groups = elements(root).filter(node => localName(node) === 'PropertyGroup' &&
    (attributeValue(node, 'Condition') ?? '') === condition);
  const matches = groups.flatMap(group => elements(group).filter(node => localName(node) === name &&
    (attributeValue(node, 'Condition') ?? '') === propertyCondition).map(node => ({group, node})));
  if (matches.length > 1) {
    throw Object.assign(new Error('Ambiguous property; specify a unique group condition'), {code: 'SFP2102'});
  }
  const selected = matches[0];
  if (value === null) {
    if (!selected) return createEditPlan(source, [], {signal});
    const removed = removableGroup(selected.group, selected.node) ? selected.group : selected.node;
    return createEditPlan(source, [removeNodeEdit(source, removed)], {signal});
  }
  if (value === undefined || typeof value === 'object') throw new Error('Property value must be a scalar or null');
  const content = escapeText(value);
  if (selected) {
    const {node} = selected;
    if (elements(node).length || node.children.some(child => ['comment', 'processingInstruction'].includes(child.kind))) {
      throw Object.assign(new Error('Property contains structured XML; edit its explicit source span'), {code: 'SFP2103'});
    }
    const edit = node.selfClosing ? {start: node.closeStart, end: node.end, text: `>${content}</${node.name}>`} :
      {start: node.openEnd, end: node.closeStart, text: content};
    return createEditPlan(source, [edit], {signal});
  }
  const layout = formatting(source, root);
  const conditionText = value => value ? ` Condition="${escapeText(value).replaceAll('"', '&quot;')}"` : '';
  const property = `<${tag}${conditionText(propertyCondition)}>${content}</${tag}>`;
  if (groups.length) return createEditPlan(source, [insertChildEdit(source, groups.at(-1), property, layout)], {signal});
  const groupTag = qualifiedName(root, 'PropertyGroup');
  const markup = layout.multiline ? `<${groupTag}${conditionText(condition)}>${layout.newline}${layout.indent.repeat(2)}` +
    `${property}${layout.newline}${layout.indent}</${groupTag}>` : `<${groupTag}${conditionText(condition)}>${property}</${groupTag}>`;
  return createEditPlan(source, [insertChildEdit(source, root, markup, layout)], {signal});
}
