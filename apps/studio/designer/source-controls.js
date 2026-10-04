import { escapeHtml as escape } from '../../../packages/editor/src/index.js';

export function sourceSyncControls(sync) {
  const state = sync.snapshot();
  const language = sync.format?.label ?? 'source';
  const label = state.uri ? '↔ ' + escape(state.uri.split('/').at(-1)) : 'Source not linked';
  return `<span class="design-sync-state ${escape(state.state)}" title="${escape(state.message)}">${label}</span>` +
    `<button data-sync="connect" title="Connect a C# construction method or XAML view">${state.uri ? 'Change file' : 'Connect source'}</button>` +
    (state.uri ? `<button data-sync="read" title="Read source changes">Read ${language}</button>` +
      `<button data-sync="write" title="Validate and write designer changes">Apply to ${language}</button>` +
      '<button data-sync="source" title="Open linked source editor">Open editor</button>' +
      '<button data-sync="disconnect" title="Disconnect">×</button>' : '') +
    `<label class="design-auto-sync"><input type="checkbox" data-sync-auto ${state.auto ? 'checked' : ''}> Auto sync</label>`;
}
