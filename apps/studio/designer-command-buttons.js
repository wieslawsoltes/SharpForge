import {escapeHtml} from '../../packages/editor/src/index.js';
import {icon} from './icons.js';

export const designerCommands = Object.freeze({
  new: {icon: 'file-plus', label: 'New'},
  open: {icon: 'folder-open', label: 'Open'},
  save: {icon: 'save', label: 'Save'},
  download: {icon: 'download', label: 'Export JSON'},
  undo: {icon: 'step-back', label: 'Undo'},
  redo: {icon: 'restart', label: 'Redo'},
  fit: {icon: 'layout', label: 'Fit'},
  preview: {icon: 'play', label: 'Test input'},
  attach: {icon: 'solution', label: 'Attach running app'},
  apply: {icon: 'check', label: 'Apply to live'},
  generate: {icon: 'build', label: 'Build and Run C#'},
  source: {icon: 'code', label: 'Source and sync'},
  delete: {icon: 'clear', label: 'Delete'},
  up: {icon: 'step-out', label: 'Move up'},
  down: {icon: 'step-in', label: 'Move down'},
  more: {icon: 'boxes', label: 'More'},
  accessibility: {icon: 'check', label: 'Check accessibility'},
  'source-hot-reload': {icon: 'refresh', label: 'Apply to source and hot reload'}
});

/** Formats a command using Studio's SVG vocabulary and an explicit accessible label. */
export function designerButton(iconName, label, command) {
  if (!label || !command) throw new TypeError('Designer commands require a label and identifier');
  return `<button type="button" class="design-command" data-design-action="${escapeHtml(command)}"` +
    ` aria-label="${escapeHtml(label)}">${icon(iconName)}` +
    `<span class="design-command-label">${escapeHtml(label)}</span></button>`;
}

/** Decorates an existing button without replacing its listener or disabled state. */
export function decorateDesignerButton(button, descriptor) {
  const definition = descriptor ?? designerCommands[button.dataset.designAction];
  if (!definition) return button;
  button.classList.add('design-command');
  button.type = 'button';
  button.setAttribute('aria-label', definition.label);
  if (!button.title) button.title = definition.label;
  button.innerHTML = icon(definition.icon) +
    `<span class="design-command-label">${escapeHtml(definition.label)}</span>`;
  return button;
}

export function decorateDesignerSync(root) {
  const commands = {
    connect: ['code', 'Connect C#'], read: ['download', 'Read C#'], write: ['check', 'Apply to C#'],
    source: ['file', 'Open source'], disconnect: ['clear', 'Disconnect C#']
  };
  for (const button of root.querySelectorAll('[data-sync]')) {
    const [iconName, label] = commands[button.dataset.sync] ?? ['code', button.textContent.trim()];
    decorateDesignerButton(button, {icon: iconName, label});
  }
}
