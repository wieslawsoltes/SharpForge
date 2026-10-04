import {visualColumnAt} from '@sharpforge/text';
import {createBoxSelections, extendBoxSelection} from '../commands/box-selection.js';
import {addCaret, insertCaretsAtLineEnds} from '../commands/multi-caret.js';

export class EditorSelectionCommands {
  constructor(editor) { this.editor = editor; }
  synchronize(operation) {
    const {editor} = this;
    editor.model.setSelections(editor.getSelections(), {primaryIndex: editor.primaryIndex, notify: false});
    operation(editor.model);
    editor.setSelections(editor.model.selections, {primaryIndex: editor.model.primaryIndex});
  }
  extendBox(options) { this.synchronize(model => extendBoxSelection(model, {...options, tabSize: this.editor.options.tabSize})); }
  extendBoxTo(direction) {
    const {editor} = this;
    const offset = editor.caretOffset;
    const position = editor.model.positionAt(offset);
    const column = visualColumnAt(editor.model.getLine(position.line), position.character, {tabSize: editor.options.tabSize});
    const movement = direction === 'wordLeft' ? 'left' : direction === 'wordRight' ? 'right' : direction;
    const next = editor.movement.destination(offset, movement, {word: direction.startsWith('word')}, editor.primaryIndex);
    const nextPosition = editor.model.positionAt(next);
    const target = visualColumnAt(editor.model.getLine(nextPosition.line), nextPosition.character, {tabSize: editor.options.tabSize});
    this.extendBox({columnDelta: target - column});
  }
  splitLines() { this.synchronize(model => insertCaretsAtLineEnds(model)); }
  addVerticalCaret(direction) {
    const {editor} = this;
    const position = editor.model.positionAt(editor.caretOffset);
    const line = Math.max(0, Math.min(editor.model.lineCount - 1, position.line + direction));
    const offset = editor.model.offsetAt({line, character: position.character});
    this.synchronize(model => addCaret(model, offset, {primary: true}));
  }
  setBox(anchor, active) {
    const {editor} = this;
    const first = editor.model.positionAt(anchor);
    const last = editor.model.positionAt(active);
    const anchorColumn = visualColumnAt(editor.model.getLine(first.line), first.character, {tabSize: editor.options.tabSize});
    const activeColumn = visualColumnAt(editor.model.getLine(last.line), last.character, {tabSize: editor.options.tabSize});
    editor.setSelections(createBoxSelections(editor.model, {anchorLine: first.line, activeLine: last.line,
      anchorColumn, activeColumn, tabSize: editor.options.tabSize}));
  }
  matchingBrace(extend) {
    const {editor} = this;
    const at = editor.pairs.has(editor.offset) ? editor.offset : editor.offset - 1;
    const target = editor.pairs.get(at);
    if (target !== undefined) editor.goto(extend ? editor.offset : target, target);
  }
  currentLine() {
    const {editor} = this;
    const line = editor.model.positionAt(editor.offset).line;
    const start = editor.model.offsetAt({line, character: 0});
    const end = line + 1 < editor.model.lineCount ? editor.model.offsetAt({line: line + 1, character: 0}) : editor.model.length;
    editor.goto(start, end);
  }
  viewportEdge(bottom, extend) {
    const {editor} = this;
    const position = editor.model.positionAt(editor.caretOffset);
    const y = editor.view.scrollTop + (bottom ? editor.view.viewport.clientHeight - editor.lineHeight : 0);
    const row = Math.max(0, Math.floor((y - editor.padding) / editor.lineHeight) - editor.view.layout.leadingRows);
    const {line} = editor.view.layout.map.lineAt(row);
    const active = editor.model.offsetAt({line, character: position.character});
    const anchor = extend ? editor.selections[editor.primaryIndex].anchor : active;
    editor.setSelections([{anchor, active}]);
  }
  hideSelection() {
    const {editor} = this;
    const first = editor.model.positionAt(editor.input.selectionStart).line;
    const last = editor.model.positionAt(editor.input.selectionEnd).line;
    if (first === last) {
      editor.accessibility.announce('Outlining hides complete source lines; select more than one line.');
      return false;
    }
    editor.folding.setRanges([...editor.folding.regions, {startLine: first, endLine: last, kind: 'manual', collapsed: true}], editor.model.lineCount);
    editor.gotoLine(first + 1);
    return true;
  }
}
