import { ControlError } from '../policy/events.js';

const maximumContainers = 64;
const maximumNodes = 100_000;

function textSegments(root) {
  const pending = [root];
  const segments = [];
  let length = 0;
  let visited = 0;
  while (pending.length) {
    const node = pending.pop();
    if (++visited > maximumNodes) throw new ControlError('SFUI1642', 'Rich-text overflow exceeds the node budget');
    if (node.nodeType === 3) {
      if (node.length) segments.push({ node, first: length, length: node.length });
      length += node.length;
    } else if (node !== root && (node.dataset?.inlineUiContainer !== undefined || node.nodeName === 'BR')) {
      segments.push({ node, first: length++, length: 1, atomic: true });
    } else for (const child of [...node.childNodes].reverse()) pending.push(child);
    if (length > 16 * 1024 * 1024) throw new ControlError('SFUI1642', 'Rich-text overflow exceeds the text budget');
  }
  return { segments, length };
}

function pointAt(index, segments, root) {
  for (const segment of segments) {
    if (index > segment.first + segment.length) continue;
    const offset = Math.max(0, index - segment.first);
    if (segment.atomic) {
      const parent = segment.node.parentNode;
      return { node: parent, offset: [...parent.childNodes].indexOf(segment.node) + (offset > 0 ? 1 : 0) };
    }
    let position = offset;
    if (position > 0 && position < segment.length && /[\uD800-\uDBFF]/.test(segment.node.data[position - 1])
      && /[\uDC00-\uDFFF]/.test(segment.node.data[position])) position--;
    return { node: segment.node, offset: position };
  }
  return { node: root, offset: root.childNodes.length };
}

function prefix(document, node, segments, index) {
  if (node.nodeType === 3) return document.createTextNode(node.data.slice(0, pointAt(index, segments, node).offset));
  const range = document.createRange();
  range.selectNodeContents(node);
  const point = pointAt(index, segments, node);
  range.setEnd(point.node, point.offset);
  const result = node.cloneNode(false);
  result.append(range.cloneContents());
  return result;
}

function splitFitting(document, container, candidate, height) {
  const { segments, length } = textSegments(candidate);
  if (!length) return { leading: null, trailing: candidate };
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const probe = prefix(document, candidate, segments, middle);
    container.append(probe);
    const fits = container.scrollHeight <= height + 0.5;
    probe.remove();
    if (fits) low = middle;
    else high = middle - 1;
  }
  if (!low) return { leading: null, trailing: candidate };
  if (low >= length) return { leading: candidate, trailing: null };
  const point = pointAt(low, segments, candidate);
  if (candidate.nodeType === 3) return { leading: candidate, trailing: candidate.splitText(point.offset) };
  const range = document.createRange();
  range.selectNodeContents(candidate);
  range.setStart(point.node, point.offset);
  const trailing = candidate.cloneNode(false);
  trailing.append(range.extractContents());
  trailing.style.textIndent = '0';
  return { leading: candidate, trailing };
}

/** Distribute actual inline nodes; only temporary measurement probes clone content. */
export function fitRichTextContainer(element, height) {
  const document = element.ownerDocument;
  const remainder = document.createDocumentFragment();
  if (!(height > 0)) {
    remainder.append(...element.childNodes);
    return remainder;
  }
  if (element.scrollHeight <= height + 0.5) return remainder;
  let candidate = null;
  while (element.lastChild && element.scrollHeight > height + 0.5) {
    candidate = element.lastChild;
    remainder.prepend(candidate);
  }
  if (!candidate) return remainder;
  candidate.remove();
  const parts = splitFitting(document, element, candidate, height);
  if (parts.leading) element.append(parts.leading);
  if (parts.trailing) remainder.prepend(parts.trailing);
  return remainder;
}

function overflowChain(context, root) {
  const chain = [];
  const visited = new Set();
  let node = root;
  while (node) {
    if (visited.has(node.id) || chain.length >= maximumContainers) {
      throw new ControlError('SFUI1642', 'Rich-text overflow chain is cyclic or exceeds 64 containers');
    }
    visited.add(node.id);
    const element = context.elements.get(node.id) ?? context.host.ensure(node.id);
    chain.push({ node, element });
    context.getState(node).richOverflowOwner = root.id;
    const next = node.properties.OverflowContentTarget;
    node = next?.$ref ? context.nodes.get(next.$ref) : null;
  }
  return chain;
}

export function markRichTextSource(context, node, rebuild) {
  const state = context.getState(node);
  state.richOverflowRebuild = rebuild;
  state.richOverflowRevision = (state.richOverflowRevision ?? 0) + 1;
}

export function flowRichText(context, node) {
  const owner = context.getState(node).richOverflowOwner;
  const root = owner ? context.nodes.get(owner) : node;
  if (!root || !root.type.endsWith('.RichTextBlock')) return;
  const state = context.getState(root);
  if (!state.richOverflowRebuild) return;
  const chain = overflowChain(context, root);
  const active = new Set(chain.map(item => item.node.id));
  for (const id of state.richOverflowNodes ?? []) {
    if (active.has(id)) continue;
    const removed = context.nodes.get(id);
    if (removed) {
      delete context.getState(removed).richOverflowOwner;
      context.elements.get(id)?.replaceChildren();
      context.invalidate(id);
    }
  }
  state.richOverflowNodes = [...active];
  const signature = [state.richOverflowRevision, ...chain.flatMap(item =>
    [item.node.id, item.element.clientWidth, item.element.clientHeight])].join(':');
  if (state.richOverflowSignature === signature) return;
  state.richOverflowSignature = signature;
  state.richOverflowRebuild();
  for (const item of chain.slice(1)) item.element.replaceChildren();
  for (let index = 0; index < chain.length; index++) {
    const { node: current, element } = chain[index];
    element.style.overflow = 'hidden';
    const remainder = fitRichTextContainer(element, element.clientHeight);
    current.properties.HasOverflowContent = remainder.childNodes.length > 0;
    if (index + 1 < chain.length) chain[index + 1].element.append(remainder);
  }
}
