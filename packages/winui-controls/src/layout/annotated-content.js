import { annotatedLabels } from './annotated-scrollbar.js';

function reference(value) {
  if (value == null) return null;
  if (!value || typeof value.$ref !== 'string' || !value.$ref || value.$ref.length > 512) {
    throw new TypeError('SFUI1677: Invalid annotated template visual identity');
  }
  return value.$ref;
}

/** Data-only projection contains already generated managed visuals; the renderer never evaluates a template definition. */
export function annotatedTemplateContent(node) {
  const value = node.properties.$layoutTemplates;
  if (value == null) return { labels: [], detail: null };
  if (value.version !== 1 || !Array.isArray(value.labels) || value.labels.length > 2048) {
    throw new TypeError('SFUI1677: Invalid annotated template content');
  }
  return { labels: value.labels.map(reference), detail: reference(value.detail) };
}

export function presentedAnnotatedLabels(node, resolve) {
  const labels = annotatedLabels(node, resolve);
  if (!node.properties.LabelTemplate) return labels;
  const content = annotatedTemplateContent(node);
  if (content.labels.length !== labels.length || content.labels.some(id => !id)) {
    throw new Error('SFTPL018: Annotated label templates must be prepared before layout');
  }
  return labels.map((label, index) => ({ ...label, Content: { $ref: content.labels[index] } }));
}

export function annotatedVisualChildren(node, resolve) {
  const values = presentedAnnotatedLabels(node, resolve).map(label => label.Content?.$ref).filter(Boolean);
  const detail = annotatedTemplateContent(node).detail;
  if (detail) values.push(detail);
  return values;
}
