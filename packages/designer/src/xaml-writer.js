import { applyXmlEdits } from '@sharpforge/project-system';
import { validateDesign } from './model.js';
import { readDesignXaml } from './xaml-reader.js';
import { serializeDesignXaml } from './xaml-serializer.js';
import { xamlAttributeName, writeXamlValue, escapeXaml, xamlError } from './xaml-values.js';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const shape = document => document.nodes.map(node => [node.id, node.type, node.children, node.rows, node.columns, node.style, node.template]);

function memberEdits(binding, before, after, { events = false, type } = {}) {
  const edits = [];
  const insertions = [];
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const existed = Object.hasOwn(before, name);
    const exists = Object.hasOwn(after, name);
    if (existed === exists && same(before[name], after[name])) continue;
    const origin = binding[events ? 'events' : 'properties'][name];
    const value = exists ? events ? after[name] : writeXamlValue(type, name, after[name]) : null;
    if (origin?.kind === 'attribute') {
      const attribute = origin.attribute;
      edits.push(exists ? { start: attribute.valueStart, end: attribute.valueEnd, text: escapeXaml(value, attribute.quote) } :
        { start: attribute.leadingStart, end: attribute.end, text: '' });
    } else if (origin?.kind === 'text') {
      edits.push({ start: origin.node.start, end: origin.node.end, text: exists ? escapeXaml(value) : '' });
    } else if (exists) insertions.push(' ' + (events ? name : xamlAttributeName(name)) + '="' + escapeXaml(value) + '"');
  }
  return { edits, insertions };
}

/** Plan optimistic source edits. A rejected candidate changes neither the XAML nor its code-behind. */
export function planDesignXamlUpdate(base, design, currentText = base.text, options = {}) {
  if (currentText !== base.text) throw xamlError('SFXAML007', 'XAML changed after synchronization; read the source before applying edits');
  options.signal?.throwIfAborted();
  const document = validateDesign(design);
  const structural = !same(shape(base.document), shape(document)) || !same(base.document.styles, document.styles) ||
    !same(base.document.templates, document.templates);
  const edits = [];
  let identityHints = Object.fromEntries(Object.entries(base.bindings).map(([id, binding]) => [binding.route, id]));
  if (structural) {
    const serialized = serializeDesignXaml(base, document);
    identityHints = serialized.identityHints;
    edits.push({ start: base.cst.root.start, end: base.cst.root.end, text: serialized.text });
  } else {
    const originalNodes = new Map(base.document.nodes.map(node => [node.id, node]));
    for (const node of document.nodes) {
      const original = originalNodes.get(node.id);
      const binding = base.bindings[node.id];
      const properties = memberEdits(binding, original.properties, node.properties, { type: node.type });
      const events = memberEdits(binding, original.events, node.events, { events: true, type: node.type });
      edits.push(...properties.edits, ...events.edits);
      const text = [...properties.insertions, ...events.insertions].join('');
      if (text) {
        const start = binding.element.selfClosing ? binding.element.closeStart : binding.element.openEnd - 1;
        edits.push({ start, end: start, text });
      }
    }
  }
  const text = applyXmlEdits(base.cst, edits, options);
  const analysis = readDesignXaml(text, { ...options, uri: base.uri, previous: document, identityHints });
  return { text, expectedText: base.text, edits, document: analysis.document, analysis, structural, warnings: analysis.warnings, sourceKind: 'xaml' };
}
