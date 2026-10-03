import { bindingsFromRows, commonBindings } from './common.js';

export const emacsBindings = Object.freeze([...commonBindings, ...bindingsFromRows('emacs', [
  ['Ctrl+B', 'Edit.CharLeft'], ['Ctrl+F', 'Edit.CharRight'], ['Ctrl+P', 'Edit.LineUp'], ['Ctrl+N', 'Edit.LineDown'],
  ['Ctrl+A', 'Edit.LineStart'], ['Ctrl+E', 'Edit.LineEnd'], ['Alt+B', 'Edit.WordPrevious'], ['Alt+F', 'Edit.WordNext'],
  ['Ctrl+D', 'Edit.Delete'], ['Ctrl+H', 'Edit.Backspace'], ['Ctrl+K', 'Emacs.KillLine'],
  ['Ctrl+W', 'Emacs.KillRegion'], ['Alt+W', 'Emacs.CopyRegion'], ['Ctrl+Y', 'Emacs.Yank'], ['Alt+Y', 'Emacs.YankPop'],
  ['Alt+D', 'Emacs.KillWord'], ['Alt+Backspace', 'Emacs.BackwardKillWord'],
  ['Ctrl+Space', 'Emacs.SetMark'], ['Ctrl+G', 'Emacs.Cancel'], ['Ctrl+X Ctrl+X', 'Emacs.ExchangePointAndMark'],
  ['Ctrl+S', 'Edit.IncrementalSearch'], ['Ctrl+R', 'Edit.ReverseIncrementalSearch'],
  ['Ctrl+X Ctrl+S', 'File.SaveSelectedItems'], ['Ctrl+X S', 'File.SaveAll'], ['Ctrl+X Ctrl+F', 'File.OpenFile'],
  ['Ctrl+X K', 'Window.CloseDocumentWindow'], ['Ctrl+X B', 'Edit.NavigateTo'],
  ['Ctrl+X 2', 'Window.NewHorizontalTabGroup'], ['Ctrl+X 3', 'Window.NewVerticalTabGroup'],
  ['Ctrl+X U', 'Edit.Undo'], ['Ctrl+/', 'Edit.Undo'], ['Alt+V', 'Edit.PageUp'], ['Ctrl+V', 'Edit.PageDown'],
  ['Alt+Shift+,', 'Edit.DocumentStart'], ['Alt+Shift+.', 'Edit.DocumentEnd'],
  ['Ctrl+T', 'Edit.TransposeCharacter'], ['Alt+T', 'Edit.TransposeWord'],
  ['Alt+U', 'Edit.MakeUppercase'], ['Alt+L', 'Edit.MakeLowercase'], ['Alt+C', 'Edit.Capitalize'],
  ['Ctrl+Alt+Space', 'Edit.CompleteWord'], ['Alt+X', 'View.CommandPalette']
], { priority: 20 })]);
