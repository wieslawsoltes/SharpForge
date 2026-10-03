/** Produces keyboard navigation/transform intentions without changing document or DOM state. */
export function designerKeyboardIntent(document, event, {isVisible = () => true} = {}) {
  if (!document?.value?.nodes || event.isComposing || event.metaKey) return null;
  const selected = document.node();
  if (!selected) return null;
  const key = event.key;
  if (key === 'Insert' && !event.ctrlKey && !event.altKey) return {kind: 'insert'};
  if (key === 'Enter' && !event.ctrlKey && !event.altKey) {
    const child = selected.children.find(isVisible);
    return child ? {kind: 'select', id: child} : null;
  }
  if (key === 'Escape') {
    const parent = document.parent(selected.id);
    return parent ? {kind: 'select', id: parent.id} : null;
  }
  if (key === 'Tab' && !event.ctrlKey && !event.altKey) {
    const nodes = new Map(document.value.nodes.map(node => [node.id, node]));
    const pending = [document.value.root];
    const order = [];
    while (pending.length) {
      const id = pending.pop();
      if (!isVisible(id)) continue;
      order.push(id);
      const node = nodes.get(id);
      for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]);
    }
    const index = order.indexOf(selected.id) + (event.shiftKey ? -1 : 1);
    return index >= 0 && index < order.length ? {kind: 'select', id: order[index]} : null;
  }
  const directions = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
  const direction = directions[key];
  if (!direction) return null;
  if (event.altKey) return {kind: 'reorder', delta: direction[0] || direction[1]};
  const step = event.ctrlKey ? 10 : 1;
  return {kind: event.shiftKey ? 'resize' : 'move', dx: direction[0] * step, dy: direction[1] * step};
}
