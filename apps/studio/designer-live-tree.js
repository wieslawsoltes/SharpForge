import {escapeHtml as escape} from '@sharpforge/editor';

/** Explicit selection callback links this runtime's visual tree to designer attachments for the same session. */
export function renderDesignerLiveTree(view, panel) {
  if (!panel) return;
  const nodes = view.scene?.nodes ?? [];
  panel.innerHTML = `<div class="panel-tools"><b>Live Visual Tree</b><button data-refresh>Refresh</button>
    <span class="panel-spacer"></span><span>${nodes.length} managed objects</span></div>
    <div class="advanced-split"><div class="advanced-visual-nodes">${nodes.map(node =>
      `<button data-visual="${escape(node.id)}" class="${node.id === view.selectedVisual ? 'selected' : ''}">
        <span>${escape(node.type.split('.').at(-1))}</span><b>${escape(node.properties.Name ?? '')}</b>
        <small>${escape(node.id)}</small></button>`).join('')}</div>
      <pre class="advanced-visual-properties"></pre></div>`;
  panel.querySelector('.advanced-visual-properties').textContent = JSON.stringify(
    nodes.find(node => node.id === view.selectedVisual) ?? {info: 'Select a live managed object.'}, null, 2);
  panel.querySelector('[data-refresh]').onclick = () => view.run(() => view.refreshVisual());
  for (const button of panel.querySelectorAll('[data-visual]')) {
    button.onclick = () => {
      view.selectedVisual = button.dataset.visual;
      view.onVisualSelection?.([view.selectedVisual], {sessionId: view.state.debug?.sessionId});
      renderDesignerLiveTree(view, panel);
    };
  }
}
