import { escapeHtml } from '@sharpforge/editor';

/** Source synchronization controls share the document command bar's button geometry. */
export function renderSourceSyncControls(snapshot) {
  const uri = snapshot.uri;
  const status = uri ? uri.split('/').at(-1) : 'C# not linked';
  const commands = uri
    ? [['read', 'Read C#'], ['write', 'Apply to C#'], ['source', 'Open editor'], ['disconnect', 'Disconnect']]
    : [['connect', 'Connect C#']];
  const buttons = commands.map(([command, title]) => {
    const disabled = command === 'write' && snapshot.canApply === false;
    return `<button type="button" class="design-command" data-sync="${command}"${disabled ? ' disabled' : ''}>${title}</button>`;
  }).join('');
  return `<span class="design-sync-state ${escapeHtml(snapshot.state)}" title="${escapeHtml(snapshot.message)}">`
    + escapeHtml(status) + '</span>' + buttons
    + '<label class="design-auto-sync"><input type="checkbox" data-sync-auto '
    + (snapshot.auto ? 'checked' : '') + '> Auto sync</label>';
}

export function bindSourceSyncControls(root, sync) {
  for (const button of root.querySelectorAll('[data-sync]')) {
    button.onclick = () => sync.view.safe(() => sync.action(button.dataset.sync));
  }
  const automatic = root.querySelector('[data-sync-auto]');
  if (automatic) automatic.onchange = () => sync.setAuto(automatic.checked);
}
