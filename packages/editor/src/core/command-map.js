import {advancedCommands} from '../commands/advanced.js';
import {outliningCommands} from '../commands/outlining.js';
import {navigateDiagnostic, announceLineState} from '../a11y/diagnostics.js';

export function editorCommandMap(editor) {
  const commands = new Map(Object.entries({...advancedCommands(editor), ...outliningCommands(editor)}));
  const extra = {
    'outlining.collapse': () => setFold(editor, true),
    'outlining.expand': () => setFold(editor, false),
    'outlining.expandAll': () => editor.folding.collapseAll(() => false),
    'view.toggleWrap': () => editor.updateOptions({wordWrap: !editor.options.wordWrap}),
    'view.toggleWhitespace': () => editor.updateOptions({renderWhitespace: !editor.options.renderWhitespace}),
    'view.zoomIn': () => editor.setZoom(editor.options.zoom + 10),
    'view.zoomOut': () => editor.setZoom(editor.options.zoom - 10),
    'view.zoomReset': () => editor.setZoom(100),
    'bookmark.toggle': () => editor.toggleBookmark(),
    'bookmark.next': () => editor.nextBookmark(1),
    'bookmark.previous': () => editor.nextBookmark(-1),
    'bookmark.clear': () => { editor.bookmarks.clear(); editor.sync(); },
    'clipboard.cycle': () => editor.clipboardRing.cycle(editor),
    'edit.toggleOvertype': () => { editor.overtype = !editor.overtype; editor.cursor(); },
    'split.toggle': () => editor.toggleSplit(),
    'diagnostics.next': () => navigateDiagnostic(editor, 1),
    'diagnostics.previous': () => navigateDiagnostic(editor, -1),
    'diagnostics.announce': () => announceLineState(editor)
  };
  Object.assign(extra, {
    'Edit.StopHidingCurrent': () => setFold(editor, false),
    'Edit.AddCaretAbove': () => editor.addVerticalCaret(-1),
    'Edit.AddCaretBelow': () => editor.addVerticalCaret(1),
    'Edit.SplitSelectionIntoLines': () => editor.splitSelectionIntoLines(),
    'Edit.LineUpExtendColumn': () => editor.extendBox({lineDelta: -1}),
    'Edit.LineDownExtendColumn': () => editor.extendBox({lineDelta: 1}),
    'Edit.CharLeftExtendColumn': () => editor.extendBox({columnDelta: -1}),
    'Edit.CharRightExtendColumn': () => editor.extendBox({columnDelta: 1}),
    'Edit.GoToMatchingBrace': () => editor.goToMatchingBrace(false),
    'Edit.GoToMatchingBraceExtend': () => editor.goToMatchingBrace(true),
    'Edit.SelectCurrentLine': () => editor.selectCurrentLine(),
    'View.ScrollLineUp': () => editor.view.scrollTo({top: editor.view.scrollTop - editor.lineHeight}),
    'View.ScrollLineDown': () => editor.view.scrollTo({top: editor.view.scrollTop + editor.lineHeight})
  });
  Object.assign(extra, {
    'Edit.LineStartExtendColumn': () => editor.selectionCommands.extendBoxTo('home'),
    'Edit.LineEndExtendColumn': () => editor.selectionCommands.extendBoxTo('end'),
    'Edit.WordPreviousExtendColumn': () => editor.selectionCommands.extendBoxTo('wordLeft'),
    'Edit.WordNextExtendColumn': () => editor.selectionCommands.extendBoxTo('wordRight'),
    'Edit.ViewTop': () => editor.selectionCommands.viewportEdge(false, false),
    'Edit.ViewTopExtend': () => editor.selectionCommands.viewportEdge(false, true),
    'Edit.ViewBottom': () => editor.selectionCommands.viewportEdge(true, false),
    'Edit.ViewBottomExtend': () => editor.selectionCommands.viewportEdge(true, true),
    'Edit.HideSelection': () => editor.selectionCommands.hideSelection(),
    'Edit.CollapseTag': () => setFold(editor, true),
    'Edit.ExpandSelectiontoContainingBlock': () => editor.expandSelection()
  });
  for (const [name, handler] of Object.entries(extra)) commands.set(name, handler);
  for (const [name, canonical] of Object.entries(commandAliases)) commands.set(name, (...args) => commands.get(canonical)?.(...args));
  return commands;
}

function setFold(editor, collapsed) {
  const line = editor.model.positionAt(editor.offset).line;
  const region = editor.folding.at(line) ?? editor.folding.containing(line).at(-1);
  if (region && region.collapsed !== collapsed) editor.folding.toggle(region.startLine);
}

export const commandAliases = Object.freeze({
  'Edit.ToggleOutliningExpansion': 'outlining.toggle', 'Edit.ToggleAllOutlining': 'outlining.toggleAll',
  'Edit.CollapseToDefinitions': 'outlining.collapseDefinitions', 'Edit.StopOutlining': 'outlining.stop',
  'Edit.CollapseCurrentRegion': 'outlining.collapse', 'Edit.UncollapseCurrentRegion': 'outlining.expand',
  'Edit.CollapseAllRegions': 'outlining.collapseAll', 'Edit.UncollapseAllRegions': 'outlining.expandAll',
  'Edit.ToggleBookmark': 'bookmark.toggle', 'Edit.NextBookmark': 'bookmark.next', 'Edit.PreviousBookmark': 'bookmark.previous',
  'Edit.ClearBookmarks': 'bookmark.clear', 'Edit.OvertypeMode': 'edit.toggleOvertype',
  'Edit.ViewWhiteSpace': 'view.toggleWhitespace', 'Edit.WordWrap': 'view.toggleWrap',
  'View.ZoomIn': 'view.zoomIn', 'View.ZoomOut': 'view.zoomOut', 'View.ZoomReset': 'view.zoomReset',
  'Edit.MakeUppercase': 'edit.uppercase', 'Edit.MakeLowercase': 'edit.lowercase',
  'Edit.DeleteHorizontalWhiteSpace': 'edit.deleteHorizontalWhitespace',
  'Edit.TransposeCharacter': 'edit.transposeCharacter', 'Edit.TransposeWord': 'edit.transposeWord',
  'Edit.TransposeLine': 'edit.transposeLine', 'Edit.JoinLines': 'edit.joinLines',
  'Edit.SortLines': 'edit.sortLines', 'Edit.ReverseLines': 'edit.reverseLines',
  'Edit.TabifySelection': 'edit.tabify', 'Edit.UntabifySelection': 'edit.untabify',
  'Edit.IncreaseLineIndent': 'edit.indent', 'Edit.DecreaseLineIndent': 'edit.outdent',
  'Edit.ToggleBlockComment': 'edit.blockComment', 'Edit.SelectCurrentWord': 'edit.selectWord',
  'Edit.CycleClipboardRing': 'clipboard.cycle', 'Edit.NextError': 'diagnostics.next', 'Edit.PreviousError': 'diagnostics.previous'
});
