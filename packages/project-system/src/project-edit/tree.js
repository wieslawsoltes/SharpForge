import {parseXmlCst, applyXmlEdits} from '../xml-cst.js';

export const localName = node => node.name?.split(':').at(-1);
export const elements = node => node.children.filter(child => child.kind === 'element');
export const attribute = (node, name) => node.attributes.find(item => item.name === name);
export const attributeValue = (node, name) => attribute(node, name)?.value;
export const escapeText = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export const escapeAttribute = (value, quote = '"') => escapeText(value).replaceAll(quote, quote === '"' ? '&quot;' : '&apos;');

export function projectTree(source, options = {}) {
  const document = parseXmlCst(source, options);
  if (localName(document.root) !== 'Project') throw Object.assign(new Error('Expected Project XML root'), {code: 'SFP2101'});
  return document;
}

export function xmlName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value)) throw new Error('Invalid project element name');
  return value;
}

export function qualifiedName(root, name) {
  return root.name.includes(':') ? root.name.slice(0, root.name.indexOf(':') + 1) + xmlName(name) : xmlName(name);
}

export function indentation(source, node) {
  const start = source.lastIndexOf('\n', node.start - 1) + 1;
  const prefix = source.slice(start, node.start);
  return /^[\t ]*$/.test(prefix) ? prefix : '';
}

export function formatting(source, root) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const child = elements(root)[0];
  const indent = child ? indentation(source, child) : '  ';
  return {newline, indent: indent || '  ', multiline: source.includes('\n')};
}

export function removeNodeEdit(source, node) {
  const lineStart = source.lastIndexOf('\n', node.start - 1) + 1;
  const next = source.indexOf('\n', node.end);
  const lineEnd = next < 0 ? source.length : next + 1;
  if (/^[\t ]*$/.test(source.slice(lineStart, node.start)) && /^[\t \r\n]*$/.test(source.slice(node.end, lineEnd))) {
    return {start: lineStart, end: lineEnd, text: ''};
  }
  return {start: node.start, end: node.end, text: ''};
}

export function insertChildEdit(source, parent, markup, layout) {
  const {newline, indent, multiline} = layout;
  const pad = indentation(source, parent);
  if (parent.selfClosing) {
    const text = multiline ? `>${newline}${pad}${indent}${markup}${newline}${pad}</${parent.name}>` : `>${markup}</${parent.name}>`;
    return {start: parent.closeStart, end: parent.end, text};
  }
  const lineStart = source.lastIndexOf('\n', parent.closeStart - 1) + 1;
  if (multiline && /^[\t ]*$/.test(source.slice(lineStart, parent.closeStart))) {
    return {start: lineStart, end: lineStart, text: `${pad}${indent}${markup}${newline}`};
  }
  return {start: parent.closeStart, end: parent.closeStart, text: markup};
}

export function removableGroup(group, removed) {
  return group.children.every(node => node === removed || node.kind === 'text' && !node.value.trim());
}

/** Edit plans carry exact inverse spans, so undo is independent of formatting heuristics. */
export function createEditPlan(source, edits, options = {}) {
  const sorted = [...edits].sort((left, right) => left.start - right.start);
  const text = applyXmlEdits(source, sorted, options);
  let shift = 0;
  const undo = sorted.map(edit => {
    const start = edit.start + shift;
    shift += edit.text.length - (edit.end - edit.start);
    return {start, end: start + edit.text.length, text: source.slice(edit.start, edit.end), expected: edit.text};
  });
  return {text, edits: sorted.map(edit => ({...edit, expected: source.slice(edit.start, edit.end)})), undo};
}
