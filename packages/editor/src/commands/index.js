import { EditorCommandContext } from './context.js';
import { registerExtendedCommands } from './extended.js';
import { moveSelections } from './movement.js';
import { changeCase, clipboardCommand, deleteLines, deleteSelections, duplicate, indent, openLine,
  selectNextOccurrence, transformLines } from './editing.js';

export { EditorCommandContext } from './context.js';

function feature(context, method, args, fallback) {
  const insights = context.editor.insights ?? context.editor.features;
  if (typeof insights?.[method] === 'function') return insights[method](...(args ?? []));
  if (typeof context.editor[method] === 'function') return context.editor[method](...(args ?? []));
  if (fallback) return context.host(fallback);
  throw new Error(`Editor feature '${method}' has no provider`);
}

function viewCommand(context, id, args) {
  if (typeof context.editor.runCommand === 'function') return context.editor.runCommand(id, args);
  throw new Error(`Editor view does not implement '${id}'`);
}

/** Named command catalog shared by the workbench, menus, accessibility actions and every editing profile. */
export function createEditorCommandRegistry(editor, options = {}) {
  const context = new EditorCommandContext(editor, options);
  const commands = new Map();
  const add = (id, handler, { edit = false, title = id.slice(id.indexOf('.') + 1) } = {}) => {
    if (commands.has(id)) throw new Error(`Duplicate editor command '${id}'`);
    const entry = Object.freeze({ id, title, category: id.split('.')[0], handler,
      enabled: () => !edit || !context.readOnly });
    commands.set(id, entry);
    return () => commands.delete(id);
  };
  for (const [name, movement] of Object.entries({
    CharLeft: 'left', CharRight: 'right', LineUp: 'up', LineDown: 'down', WordPrevious: 'wordLeft', WordNext: 'wordRight',
    SubwordPrevious: 'subwordLeft', SubwordNext: 'subwordRight', LineStart: 'home', LineEnd: 'end',
    DocumentStart: 'documentStart', DocumentEnd: 'documentEnd', PageUp: 'pageUp', PageDown: 'pageDown'
  })) {
    add(`Edit.${name}`, args => moveSelections(context, movement, args));
    add(`Edit.${name}Extend`, args => moveSelections(context, movement, { ...args, extend: true }));
  }
  const editing = {
    Backspace: () => deleteSelections(context, -1), Delete: () => deleteSelections(context, 1),
    WordDeleteToStart: () => deleteSelections(context, -1, true), WordDeleteToEnd: () => deleteSelections(context, 1, true),
    BreakLine: () => feature(context, 'insertNewline', [], null),
    InsertTab: () => indent(context), TabLeft: () => indent(context, true),
    LineDelete: () => deleteLines(context), Duplicate: () => duplicate(context),
    CopyLineUp: () => duplicate(context, -1, true), CopyLineDown: () => duplicate(context, 1, true),
    LineOpenAbove: () => openLine(context, true), LineOpenBelow: () => openLine(context),
    MakeUppercase: () => changeCase(context, 'upper'), MakeLowercase: () => changeCase(context, 'lower'),
    Capitalize: () => changeCase(context, 'title'),
    DeleteHorizontalWhiteSpace: () => transformLines(context, line => line.replace(/[\t ]+/g, '')),
    TrimTrailingWhiteSpace: () => transformLines(context, line => line.replace(/[\t ]+$/g, '')),
    ConvertSpacesToTabs: () => transformLines(context, line => line.replace(/^( +)/, value =>
      '\t'.repeat(Math.floor(value.length / 4)) + ' '.repeat(value.length % 4))),
    ConvertTabsToSpaces: () => transformLines(context, line => line.replace(/\t/g, ' '.repeat(editor.options?.tabSize ?? 4))),
    CommentSelection: () => editor.toggleLineComment(false), UncommentSelection: () => editor.toggleLineComment(true),
    ToggleLineComment: () => editor.toggleLineComment(), MoveSelectedLinesUp: () => editor.moveLines(-1),
    MoveSelectedLinesDown: () => editor.moveLines(1), Cut: () => clipboardCommand(context, 'cut'),
    Paste: () => clipboardCommand(context, 'paste'), LineCut: () => clipboardCommand(context, 'cut')
  };
  for (const [name, handler] of Object.entries(editing)) add(`Edit.${name}`, handler, { edit: true });
  add('Edit.Undo', () => editor.undo(), { edit: true });
  add('Edit.Redo', () => editor.undo(true), { edit: true });
  add('Edit.Copy', () => clipboardCommand(context, 'copy'));
  add('Edit.SelectAll', () => context.select([{ anchor: 0, head: context.length }]));
  add('Edit.SelectCurrentWord', () => selectNextOccurrence(context));
  add('Edit.AddNextOccurrence', () => selectNextOccurrence(context));
  add('Edit.SelectAllOccurrences', () => selectNextOccurrence(context, true));
  add('Edit.SelectionCancel', () => {
    const head = context.selection.head;
    context.select([{ anchor: head, head }]);
    editor.closeCompletion?.();
  });
  add('Edit.Find', () => feature(context, 'openFind', [false]));
  add('Edit.Replace', () => feature(context, 'openFind', [true]));
  add('Edit.FindNext', () => feature(context, 'findNext', [false, 1]));
  add('Edit.FindPrevious', () => feature(context, 'findNext', [false, -1]));
  add('Edit.FindNextSelected', () => feature(context, 'findSelected', [1], 'findSelected'));
  add('Edit.FindPreviousSelected', () => feature(context, 'findSelected', [-1], 'findSelected'));
  add('Edit.IncrementalSearch', () => feature(context, 'incrementalSearch', [1]));
  add('Edit.ReverseIncrementalSearch', () => feature(context, 'incrementalSearch', [-1]));
  add('Edit.GoTo', () => feature(context, 'openGoTo', [], 'goto'));
  const insight = {
    CompleteWord: ['complete'], ListMembers: ['complete'], ParameterInfo: ['signatureHelp'],
    QuickInfo: ['quickInfo'], SurroundWith: ['surroundWith'], InsertSnippet: ['insertSnippet'],
    ToggleCompletionMode: ['toggleCompletionMode'], PeekDefinition: ['peekDefinition', 'definition'],
    Rename: ['rename', 'rename'], ExpandSelection: ['expandSelection'], ShrinkSelection: ['shrinkSelection']
  };
  for (const [name, [method, fallback]] of Object.entries(insight)) {
    add(`Edit.${name}`, () => feature(context, method, [], fallback), { edit: ['FormatDocument', 'FormatSelection', 'Rename'].includes(name) });
  }
  add('Edit.FormatDocument', () => feature(context, 'format', [{}], 'format'), { edit: true });
  add('Edit.FormatSelection', () => feature(context, 'format', [{ range: {
    start: context.position(Math.min(context.selection.anchor, context.selection.head)),
    end: context.position(Math.max(context.selection.anchor, context.selection.head))
  } }], 'format'), { edit: true });
  add('View.ShowSmartTag', () => feature(context, 'codeActions', [], 'codeActions'));
  add('Refactor.Rename', () => feature(context, 'rename', [], 'rename'), { edit: true });
  add('Refactor.ExtractMethod', () => context.host('codeActions', { kind: 'extractMethod' }), { edit: true });
  add('EditorContextMenus.CodeWindow.RemoveAndSort', () => context.host('codeActions', { kind: 'organizeImports' }), { edit: true });
  for (const [id, host] of Object.entries({
    'Edit.GoToDefinition': 'definition', 'Edit.GoToDeclaration': 'definition', 'Edit.FindAllReferences': 'references',
    'Edit.FindinFiles': 'findFiles', 'Edit.ReplaceinFiles': 'replaceFiles', 'Edit.NavigateTo': 'navigateTo',
    'Edit.GoToFindCombo': 'findFiles', 'File.SaveSelectedItems': 'save', 'File.SaveAll': 'saveAll',
    'File.OpenFile': 'openDocumentPrompt', 'File.NewFile': 'newDocument',
    'Window.CloseDocumentWindow': 'closeDocument', 'Window.NextDocumentWindow': 'nextDocument',
    'Window.PreviousDocumentWindow': 'previousDocument', 'Window.ReopenClosedTab': 'reopenClosedDocument', 'Window.NextDocumentWindowNav': 'nextDocument',
    'Window.PreviousDocumentWindowNav': 'previousDocument', 'View.NavigateBackward': 'navigateBack',
    'View.NavigateForward': 'navigateForward', 'View.CommandPalette': 'commands', 'View.Settings': 'settings',
    'View.KeyboardSettings': 'keyboardSettings', 'Debug.ToggleBreakpoint': 'toggleBreakpoint',
    'Debug.Start': 'debug', 'Debug.StartWithoutDebugging': 'run', 'Debug.StopDebugging': 'stop',
    'Debug.Restart': 'restart', 'Debug.StepOver': 'next', 'Debug.StepInto': 'stepIn', 'Debug.StepOut': 'stepOut',
    'Debug.RunToCursor': 'runToCursor', 'Debug.SetNextStatement': 'setNext', 'Build.BuildSolution': 'build',
    'Window.NewVerticalTabGroup': 'splitVertical', 'Window.NewHorizontalTabGroup': 'splitHorizontal'
  })) add(id, args => context.host(host, args));
  for (const id of [
    'Edit.CollapseToDefinitions', 'Edit.ToggleAllOutlining', 'Edit.ToggleOutliningExpansion', 'Edit.StopOutlining',
    'Edit.StopHidingCurrent', 'Edit.CollapseCurrentRegion', 'Edit.UncollapseCurrentRegion',
    'Edit.CollapseAllRegions', 'Edit.UncollapseAllRegions', 'Edit.ToggleBookmark', 'Edit.NextBookmark',
    'Edit.PreviousBookmark', 'Edit.ClearBookmarks', 'Edit.LineUpExtendColumn', 'Edit.LineDownExtendColumn',
    'Edit.CharLeftExtendColumn', 'Edit.CharRightExtendColumn', 'Edit.AddCaretAbove', 'Edit.AddCaretBelow',
    'Edit.SplitSelectionIntoLines', 'Edit.OvertypeMode', 'Edit.ViewWhiteSpace', 'Edit.WordWrap',
    'Edit.TransposeCharacter', 'Edit.TransposeWord', 'Edit.TransposeLine', 'Edit.JoinLines', 'Edit.SortLines',
    'Edit.GoToMatchingBrace', 'Edit.GoToMatchingBraceExtend', 'Edit.SelectCurrentLine',
    'Edit.ReverseLines', 'View.ZoomIn', 'View.ZoomOut', 'View.ZoomReset', 'View.ScrollLineUp', 'View.ScrollLineDown'
  ]) add(id, args => viewCommand(context, id, args));
  registerExtendedCommands(add, commands, context, feature, viewCommand);
  return {
    context, register: add, has: id => commands.has(id), get: id => commands.get(id),
    list: () => [...commands.values()].map(({ handler, enabled, ...item }) => ({ ...item, enabled: enabled() })),
    execute(id, args) {
      const entry = commands.get(id);
      if (!entry) throw new Error(`Unknown editor command '${id}'`);
      if (!entry.enabled()) return false;
      return entry.handler(args);
    },
    dispose: () => { context.dispose(); commands.clear(); }
  };
}
