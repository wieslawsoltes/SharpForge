import {FoldingModel, LargeFilePolicy, VirtualEditorView, editorOptions} from '@sharpforge/editor';
import {inputView} from './a20-input-view.js';

/** Only DOM sizing and frame delivery are controlled; all line, wrap, fold, scroll and input geometry is production code. */
export function geometryView(model, selections, options = {}, onEdit) {
  const editor = inputView(model, selections, onEdit);
  const document = editor.element.ownerDocument;
  const create = document.createElement;
  const decorate = element => {
    element.clientWidth = 320;
    element.clientHeight = 120;
    element.scrollTop = 0;
    element.classList.toggle = () => {};
    element.style.setProperty = (name, value) => { element.style[name] = value; };
    element.getBoundingClientRect = () => ({left: 0, top: 0, width: element.clientWidth, height: element.clientHeight});
    Object.defineProperties(element, {
      scrollHeight: {get: () => Math.max(element.clientHeight, parseFloat(element.children[0]?.style.height) || 0)},
      scrollWidth: {get: () => Math.max(element.clientWidth, parseFloat(element.children[0]?.style.width) || 0)}
    });
    let left = element.scrollLeft;
    Object.defineProperty(element, 'scrollLeft', {
      get: () => left,
      set: value => { left = Math.max(0, Math.min(value, element.scrollWidth - element.clientWidth)); }
    });
    let width;
    Object.defineProperty(element.style, 'width', {
      get: () => width,
      set: value => {
        width = value;
        // Native layout clamps the viewport immediately when its scroll surface shrinks.
        if (element.parent) element.parent.scrollLeft = element.parent.scrollLeft;
      }
    });
    return element;
  };
  document.createElement = tag => decorate(create(tag));
  const frames = new Map();
  let sequence = 0;
  Object.assign(document.defaultView, {
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }
  });
  decorate(editor.element);
  editor.options = editorOptions(options);
  editor.padding = 14;
  editor.viewZones = new Map();
  editor.inlineWidgets = new Map();
  editor.folding = new FoldingModel();
  editor.largeFile = new LargeFilePolicy(editor);
  editor.largeFile.update();
  editor.view = new VirtualEditorView(editor);
  editor.foldSubscription = editor.folding.onDidChange(() => {
    editor.view.layout.applyFolding();
    editor.decorationRevision++;
    editor.view.schedule();
  });
  editor.view.layout.reset();
  editor.view.scroll.update([]);
  editor.inputController.synchronize();
  return editor;
}

export function geometryAtCaret(editor) {
  return {lineCount: editor.view.layout.map.lineCount, caret: editor.caretOffset,
    source: editor.view.layout.position(editor.caretOffset).record.text, coords: editor.view.coordsAt(editor.caretOffset)};
}
