import { GitError } from '@sharpforge/git';
import { gitElement } from './git-dom.js';
import { gitEditorView, gitEditorCursorGeometry, subscribeGitEditorView } from './git-editor-geometry.js';

/** Measure a UTF-16 source offset using the editor font and CSS pixel tab stops. */
export function measureCollaborationCursor(source, offset, metrics) {
  offset = Math.max(0, Math.min(source.length, offset));
  const point = source.positionAt(offset);
  let start = source.lineStarts[point.line];
  let width = 0;
  const tabWidth = metrics.tabWidth;
  for (let cursor = start; cursor < offset; cursor++) {
    if (source.text[cursor] !== '\t') continue;
    width += metrics.measure(source.text.slice(start, cursor));
    width = (Math.floor(width / tabWidth) + 1) * tabWidth;
    start = cursor + 1;
  }
  width += metrics.measure(source.text.slice(start, offset));
  return { x: metrics.paddingLeft + width - metrics.scrollLeft,
    y: metrics.paddingTop + point.line * metrics.lineHeight - metrics.scrollTop, line: point.line };
}

/** Return the visible UTF-16 end of a line, excluding CRLF/CR/LF without dropping the last source character. */
export function collaborationLineEnd(source, line) {
  let end = source.lineStarts[line + 1] ?? source.length;
  while (end > source.lineStarts[line] && (source.text[end - 1] === '\r' || source.text[end - 1] === '\n')) end--;
  return end;
}

function drawNativePeer(document, peer, geometry, nodes) {
  const selection = peer.selection;
  if (!selection || !Number.isInteger(selection.anchor) || !Number.isInteger(selection.focus) || nodes.length >= 2048) return;
  const caret = geometry.caret(selection.focus);
  if (caret && caret.y + caret.height > 0 && caret.y < geometry.height) {
    const label = gitElement(document, 'span', { text: peer.name ?? peer.clientId });
    label.style.backgroundColor = peer.color;
    const node = gitElement(document, 'div', { className: 'git-remote-caret', 'data-peer-id': peer.clientId }, label);
    Object.assign(node.style, { left: `${caret.x}px`, top: `${caret.y}px`, height: `${caret.height}px`, borderColor: peer.color });
    nodes.push(node);
  }
  for (const rect of geometry.selections(selection.anchor, selection.focus, 2048 - nodes.length)) {
    const node = gitElement(document, 'div', { className: 'git-remote-selection' });
    Object.assign(node.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${Math.max(1, rect.width)}px`,
      height: `${rect.height}px`, backgroundColor: peer.color });
    nodes.push(node);
  }
}

function drawLegacyPeer(editor, document, peer, { source, metrics, first, last, nodes }) {
  const selection = peer.selection;
  if (!selection || !Number.isInteger(selection.anchor) || !Number.isInteger(selection.focus) || nodes.length >= 2048) return;
  const caret = measureCollaborationCursor(source, selection.focus, metrics);
  if (caret.y >= -editor.lineHeight && caret.y < editor.element.clientHeight) {
    const label = gitElement(document, 'span', { text: peer.name ?? peer.clientId });
    label.style.backgroundColor = peer.color;
    const node = gitElement(document, 'div', { className: 'git-remote-caret', 'data-peer-id': peer.clientId }, label);
    Object.assign(node.style, { left: `${caret.x}px`, top: `${caret.y}px`, height: `${editor.lineHeight}px`, borderColor: peer.color });
    nodes.push(node);
  }
  const start = Math.max(0, Math.min(selection.anchor, selection.focus));
  const end = Math.min(source.length, Math.max(selection.anchor, selection.focus));
  for (let line = first; line < last && nodes.length < 2048; line++) {
    const lineStart = source.lineStarts[line];
    const nextStart = source.lineStarts[line + 1] ?? source.length;
    if (end <= lineStart || start >= nextStart) continue;
    const left = measureCollaborationCursor(source, Math.max(start, lineStart), metrics);
    const right = measureCollaborationCursor(source, Math.min(end, collaborationLineEnd(source, line)), metrics);
    const node = gitElement(document, 'div', { className: 'git-remote-selection' });
    Object.assign(node.style, { left: `${left.x}px`, top: `${left.y}px`,
      width: `${Math.max(3, right.x - left.x)}px`, height: `${editor.lineHeight}px`, backgroundColor: peer.color });
    nodes.push(node);
  }
}

function legacyCursorNodes(editor, document, window, context, peers) {
  const style = window.getComputedStyle(editor.input);
  context.font = style.font;
  const metrics = {
    measure: text => context.measureText(text).width,
    tabWidth: Math.max(1, (Number(style.tabSize) || 4) * context.measureText(' ').width),
    paddingLeft: parseFloat(style.paddingLeft) || 0, paddingTop: parseFloat(style.paddingTop) || editor.padding,
    scrollLeft: editor.input.scrollLeft, scrollTop: editor.input.scrollTop, lineHeight: editor.lineHeight
  };
  const source = editor.sourceSnapshot();
  const nodes = [];
  const first = Math.max(0, Math.floor((metrics.scrollTop - metrics.paddingTop) / editor.lineHeight));
  const last = Math.min(source.lineStarts.length, first + Math.ceil(editor.element.clientHeight / editor.lineHeight) + 2);
  for (const peer of peers) drawLegacyPeer(editor, document, peer, { source, metrics, first, last, nodes });
  return nodes;
}

/** Render remote selections on the standard editor without changing its source model. */
export function createGitEditorCursors(editor) {
  const document = editor.element.ownerDocument;
  const window = document.defaultView;
  const view = gitEditorView(editor);
  const viewport = view?.viewport ?? editor.element.querySelector('.sf-viewport');
  const context = view ? null : document.createElement('canvas').getContext('2d');
  if (!viewport || (!view && !context) || !window?.ResizeObserver || !window.requestAnimationFrame) {
    throw new GitError('Unsupported', 'Remote cursors require the standard editor and browser layout APIs');
  }
  const uri = editor.uri;
  const layer = gitElement(document, 'div', { className: 'git-remote-cursors', 'aria-hidden': 'true' });
  (view ? editor.element : viewport).append(layer);
  let peers = [];
  let disposed = false;
  let frame = null;

  function draw() {
    frame = null;
    if (disposed) return;
    layer.hidden = editor.disposed || editor.uri !== uri || editor.element.classList.contains('sf-classic-active');
    if (layer.hidden) { layer.replaceChildren(); return; }
    const geometry = gitEditorCursorGeometry(editor);
    if (geometry) {
      Object.assign(layer.style, { left: `${geometry.left}px`, top: `${geometry.top}px`, right: 'auto', bottom: 'auto',
        width: `${geometry.width}px`, height: `${geometry.height}px` });
      const nodes = [];
      for (const peer of peers) drawNativePeer(document, peer, geometry, nodes);
      layer.replaceChildren(...nodes);
      return;
    }
    layer.replaceChildren(...legacyCursorNodes(editor, document, window, context, peers));
  }

  function schedule() {
    if (!disposed && frame === null) frame = window.requestAnimationFrame(draw);
  }
  const observer = new window.ResizeObserver(schedule);
  observer.observe(viewport);
  const unsubscribeView = subscribeGitEditorView(editor, { render: schedule, dispose });
  if (!unsubscribeView) editor.input.addEventListener('scroll', schedule);
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (frame !== null) window.cancelAnimationFrame(frame);
    unsubscribeView?.();
    observer.disconnect();
    editor.input.removeEventListener('scroll', schedule);
    peers = [];
    layer.remove();
  }
  return { set(values) { peers = values.slice(0, 64); schedule(); }, redraw: schedule, dispose };
}
