const definitions = [
  ['ArrowLeft', 'Edit.CharLeft'], ['ArrowRight', 'Edit.CharRight'], ['ArrowUp', 'Edit.LineUp'], ['ArrowDown', 'Edit.LineDown'],
  ['Shift+ArrowLeft', 'Edit.CharLeftExtend'], ['Shift+ArrowRight', 'Edit.CharRightExtend'],
  ['Shift+ArrowUp', 'Edit.LineUpExtend'], ['Shift+ArrowDown', 'Edit.LineDownExtend'],
  ['Home', 'Edit.LineStart'], ['End', 'Edit.LineEnd'], ['Shift+Home', 'Edit.LineStartExtend'], ['Shift+End', 'Edit.LineEndExtend'],
  ['Mod+Home', 'Edit.DocumentStart'], ['Mod+End', 'Edit.DocumentEnd'],
  ['Mod+Shift+Home', 'Edit.DocumentStartExtend'], ['Mod+Shift+End', 'Edit.DocumentEndExtend'],
  ['Mod+ArrowLeft', 'Edit.WordPrevious'], ['Mod+ArrowRight', 'Edit.WordNext'],
  ['Mod+Shift+ArrowLeft', 'Edit.WordPreviousExtend'], ['Mod+Shift+ArrowRight', 'Edit.WordNextExtend'],
  ['PageUp', 'Edit.PageUp'], ['PageDown', 'Edit.PageDown'],
  ['Shift+PageUp', 'Edit.PageUpExtend'], ['Shift+PageDown', 'Edit.PageDownExtend'],
  ['Backspace', 'Edit.Backspace'], ['Delete', 'Edit.Delete'], ['Mod+Backspace', 'Edit.WordDeleteToStart'],
  ['Mod+Delete', 'Edit.WordDeleteToEnd'], ['Enter', 'Edit.BreakLine'], ['Tab', 'Edit.InsertTab'], ['Shift+Tab', 'Edit.TabLeft'],
  ['Mod+A', 'Edit.SelectAll'], ['Mod+C', 'Edit.Copy'], ['Mod+X', 'Edit.Cut'], ['Mod+V', 'Edit.Paste'],
  ['Mod+Z', 'Edit.Undo'], ['Mod+Y', 'Edit.Redo'], ['Mod+Shift+Z', 'Edit.Redo'],
  ['Mod+F', 'Edit.Find'], ['Mod+H', 'Edit.Replace'], ['F3', 'Edit.FindNext'], ['Shift+F3', 'Edit.FindPrevious'],
  ['Mod+F3', 'Edit.FindNextSelected'], ['Mod+Shift+F3', 'Edit.FindPreviousSelected'],
  ['F12', 'Edit.GoToDefinition'], ['Shift+F12', 'Edit.FindAllReferences'], ['Mod+F12', 'Edit.GoToDeclaration'],
  ['Alt+F12', 'Edit.PeekDefinition'], ['Mod+Space', 'Edit.CompleteWord'], ['Mod+Shift+Space', 'Edit.ParameterInfo'],
  ['Mod+.', 'View.ShowSmartTag'], ['Mod+/', 'Edit.ToggleLineComment'], ['Mod+Shift+F', 'Edit.FindinFiles'],
  ['Mod+Shift+H', 'Edit.ReplaceinFiles'], ['Mod+S', 'File.SaveSelectedItems'], ['Mod+Shift+S', 'File.SaveAll'],
  ['Mod+F4', 'Window.CloseDocumentWindow'], ['Ctrl+F6', 'Window.NextDocumentWindow'],
  ['Ctrl+Shift+F6', 'Window.PreviousDocumentWindow'], ['Mod+Alt+N', 'File.NewFile'],
  ['Alt+ArrowUp', 'Edit.MoveSelectedLinesUp'], ['Alt+ArrowDown', 'Edit.MoveSelectedLinesDown'],
  ['Escape', 'Edit.SelectionCancel'], ['Insert', 'Edit.OvertypeMode'], ['Mod+Alt+O', 'File.OpenFile'],
  ['F5', 'Debug.Start'], ['Mod+F5', 'Debug.StartWithoutDebugging'], ['Shift+F5', 'Debug.StopDebugging'],
  ['Mod+Shift+F5', 'Debug.Restart'], ['F9', 'Debug.ToggleBreakpoint'], ['F10', 'Debug.StepOver'],
  ['F11', 'Debug.StepInto'], ['Shift+F11', 'Debug.StepOut'], ['Mod+F10', 'Debug.RunToCursor'],
  ['Mod+Shift+F10', 'Debug.SetNextStatement'], ['Mod+Shift+B', 'Build.BuildSolution']
];

export function bindingsFromRows(profile, rows, { priority = 0, scope = 'Text Editor' } = {}) {
  return rows.map(([keys, command, args], index) => Object.freeze({
    id: `${profile}:${index}`, keys, command, ...(args === undefined ? {} : { args }), scope, priority
  }));
}

export const commonBindings = Object.freeze(bindingsFromRows('common', definitions));
